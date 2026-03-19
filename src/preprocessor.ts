import OpenAI from "openai";
import { config } from "./config.ts";

const visionClient = new OpenAI({
  baseURL: config.visionModel.baseUrl,
  apiKey:  config.visionModel.apiKey,
});

// ─────────────────────────────────────────────────────────────
// Vision: описать изображение через VISION_MODEL
// ─────────────────────────────────────────────────────────────
async function describeImage(base64: string, mediaType: string): Promise<string> {
  const res = await visionClient.chat.completions.create({
    model: config.visionModel.model,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
        { type: "text", text: "Детально опиши изображение. Если есть текст, код или ошибки — процитируй точно." },
      ],
    }],
  });
  return res.choices[0]?.message.content ?? "";
}

// ─────────────────────────────────────────────────────────────
// Достать base64 из data URL или по внешнему URL
// ─────────────────────────────────────────────────────────────
async function resolveImageUrl(url: string): Promise<{ base64: string; mediaType: string }> {
  if (url.startsWith("data:")) {
    const [meta, data] = url.split(",");
    return {
      base64:    data as string,
      mediaType: (meta ?? "image/png").replace("data:", "").replace(";base64", ""),
    };
  }
  const res  = await fetch(url);
  const buf  = await res.arrayBuffer();
  return {
    base64:    Buffer.from(buf).toString("base64"),
    mediaType: res.headers.get("content-type") ?? "image/png",
  };
}

// ─────────────────────────────────────────────────────────────
// Обработать блок контента одного сообщения
// Anthropic content block: { type: "image", source: ... }
// ─────────────────────────────────────────────────────────────
async function processBlock(block: any): Promise<any> {
  if (block.type !== "image") return block;

  const src = block.source;
  let base64: string;
  let mediaType: string;

  if (src.type === "base64") {
    base64    = src.data;
    mediaType = src.media_type;
  } else if (src.type === "url") {
    ({ base64, mediaType } = await resolveImageUrl(src.url));
  } else {
    return block;
  }

  const description = await describeImage(base64, mediaType);
  console.log(`[vision] Изображение обработано моделью ${config.visionModel.model}`);
  return { type: "text", text: `[Изображение: ${description}]` };
}

// ─────────────────────────────────────────────────────────────
// Файлы: найти пути в тексте и подставить содержимое
//
// Поддерживаются:
//   /absolute/path/to/file.ts
//   ./relative/file.py
//   ~/home/path/file.md
//
// Claude Code сам умеет читать файлы, но если основная модель
// слабее — явный контент в промпте помогает качеству ответа.
// Отключается через FILE_INJECT=false
// ─────────────────────────────────────────────────────────────
const FILE_PATH_RE = /(?:^|[\s`"'])((~|\.{1,2})?\/[\w./@\-]+\.\w{1,10})/gm;
const FILE_INJECT  = Bun.env.FILE_INJECT !== "false";
const MAX_FILE_SIZE = 100 * 1024; // 100KB — не инжектируем огромные файлы

async function injectFiles(text: string): Promise<string> {
  if (!FILE_INJECT) return text;

  const found = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = FILE_PATH_RE.exec(text)) !== null) {
    found.add(match[1] as string);
  }

  if (found.size === 0) return text;

  const injections: string[] = [];

  for (const rawPath of found) {
    try {
      const absPath = rawPath.startsWith("~")
        ? rawPath.replace("~", Bun.env.HOME ?? "~")
        : rawPath;

      const file = Bun.file(absPath);
      if (!file.size || file.size > MAX_FILE_SIZE) continue;

      const content = await file.text(); // Bun.file.text() sync не существует, см. ниже
      injections.push(`\`\`\`\n// ${absPath}\n${content}\n\`\`\``);
    } catch {
      // файл не существует или нет доступа — пропускаем
    }
  }

  if (injections.length === 0) return text;

  return text + "\n\n[Содержимое файлов:]\n" + injections.join("\n\n");
}

// Bun.file().text() — async, поэтому нужна async версия injectFiles
async function injectFilesAsync(text: string): Promise<string> {
  if (!FILE_INJECT) return text;

  const found = new Set<string>();
  const re    = new RegExp(FILE_PATH_RE.source, FILE_PATH_RE.flags);
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    found.add(match[1] as string);
  }

  if (found.size === 0) return text;

  const injections: string[] = [];

  for (const rawPath of found) {
    try {
      const absPath = rawPath.startsWith("~")
        ? rawPath.replace("~", Bun.env.HOME ?? "/root")
        : rawPath;

      const file = Bun.file(absPath);
      if (file.size > MAX_FILE_SIZE) continue;

      const content = await file.text();
      injections.push(`\`\`\`\n// ${absPath}\n${content}\n\`\`\``);
      console.log(`[files] Инжектирован файл: ${absPath}`);
    } catch {
      // тихо пропускаем
    }
  }

  if (injections.length === 0) return text;

  return text + "\n\n[Содержимое файлов:]\n" + injections.join("\n\n");
}

// ─────────────────────────────────────────────────────────────
// Главная функция — обработать все сообщения
// ─────────────────────────────────────────────────────────────
export async function preprocessMessages(messages: any[]): Promise<any[]> {
  return Promise.all(messages.map(async (msg) => {
    // content — строка
    if (typeof msg.content === "string") {
      return { ...msg, content: await injectFilesAsync(msg.content) };
    }

    // content — массив блоков
    if (Array.isArray(msg.content)) {
      const newContent = await Promise.all(msg.content.map(async (block: any) => {
        if (block.type === "image") {
          return processBlock(block);
        }
        if (block.type === "text") {
          return { ...block, text: await injectFilesAsync(block.text) };
        }
        return block;
      }));
      return { ...msg, content: newContent };
    }

    return msg;
  }));
}
