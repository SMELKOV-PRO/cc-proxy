import OpenAI from "openai";
import { config }               from "./config";
import { webSearch }            from "./search";
import { describeImageFromUrl, preprocessImageBlocks } from "./vision";

// ─────────────────────────────────────────────────────────────
// Константы
// ─────────────────────────────────────────────────────────────
const MAX_ITERATIONS = Number(process.env.AGENT_MAX_ITERATIONS ?? 10);

const FILE_PATH_RE  = /(?:^|[\s`"'])((~|\.{1,2})?\/[\w./@\-]+\.\w{1,10})/gm;
const FILE_INJECT   = process.env.FILE_INJECT !== "false";
const MAX_FILE_SIZE = 100 * 1024; // 100 KB

// ─────────────────────────────────────────────────────────────
// Tools definition
// Добавлять новые тулы: 1) сюда, 2) в executeTool ниже
// ─────────────────────────────────────────────────────────────
function buildTools(): OpenAI.Chat.ChatCompletionTool[] {
  const tools: OpenAI.Chat.ChatCompletionTool[] = [];

  // web_search — только если поиск включён в конфиге
  if (config.search.enabled) {
    tools.push({
      type: "function",
      function: {
        name: "web_search",
        description: [
          "Search the web for up-to-date information.",
          "Use for: recent events, news, current prices, docs, people, companies.",
          "Do NOT use for general knowledge you can answer directly.",
        ].join(" "),
        parameters: {
          type:       "object",
          properties: {
            query: {
              type:        "string",
              description: "Concise search query, 3–7 words, same language as user.",
            },
          },
          required: ["query"],
        },
      },
    });
  }

  // describe_image — только если vision включён в конфиге
  if (config.visionModel.enabled) {
    tools.push({
      type: "function",
      function: {
        name: "describe_image",
        description: [
          "Describe or analyze an image from a URL or data URI.",
          "Use when the user shares an image link or asks about visual content.",
          "Returns detailed text description including any text, code, or errors in the image.",
        ].join(" "),
        parameters: {
          type:       "object",
          properties: {
            url: {
              type:        "string",
              description: "Image URL (https://) or data URI (data:image/...;base64,...)",
            },
          },
          required: ["url"],
        },
      },
    });
  }

  return tools;
}

// ─────────────────────────────────────────────────────────────
// Tool executor — единственное место для добавления новых тулов
// ─────────────────────────────────────────────────────────────
async function executeTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case "web_search":
      return webSearch(args.query as string);

    case "describe_image":
      return describeImageFromUrl(args.url as string);

    default:
      return `Unknown tool: "${name}"`;
  }
}

// ─────────────────────────────────────────────────────────────
// Preprocessing — файлы и картинки в сообщениях
// ─────────────────────────────────────────────────────────────
async function injectFiles(text: string): Promise<string> {
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
        ? rawPath.replace("~", process.env.HOME ?? "/root")
        : rawPath;

      const file = Bun.file(absPath);
      if (file.size > MAX_FILE_SIZE) continue;

      const content = await file.text();
      injections.push(`\`\`\`\n// ${absPath}\n${content}\n\`\`\``);
      console.log(`[files] Инжектирован: ${absPath}`);
    } catch {
      // файл не существует или нет доступа — пропускаем
    }
  }

  if (injections.length === 0) return text;
  return `${text}\n\n[Содержимое файлов:]\n${injections.join("\n\n")}`;
}

async function preprocessMessages(messages: any[]): Promise<any[]> {
  return Promise.all(messages.map(async (msg) => {
    // Строка — инжектируем файлы
    if (typeof msg.content === "string") {
      return { ...msg, content: await injectFiles(msg.content) };
    }

    // Массив блоков — обрабатываем картинки и текст
    if (Array.isArray(msg.content)) {
      // Сначала конвертируем image блоки в text (vision preprocessing)
      const withImages = await preprocessImageBlocks(msg.content);

      // Потом инжектируем файлы в текстовые блоки
      const newContent = await Promise.all(withImages.map(async (block: any) => {
        if (block.type === "text") {
          return { ...block, text: await injectFiles(block.text) };
        }
        return block;
      }));

      return { ...msg, content: newContent };
    }

    return msg;
  }));
}

// ─────────────────────────────────────────────────────────────
// Anthropic messages → OpenAI messages
// ─────────────────────────────────────────────────────────────
function toOpenAIMessages(body: any, processedMessages: any[]): OpenAI.Chat.ChatCompletionMessageParam[] {
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];

  if (body.system) {
    const systemText = Array.isArray(body.system)
      ? body.system.map((b: any) => b.text ?? "").join("\n")
      : String(body.system);
    messages.push({ role: "system", content: systemText });
  }

  for (const msg of processedMessages) {
    if (typeof msg.content === "string") {
      messages.push({ role: msg.role, content: msg.content });
      continue;
    }

    if (!Array.isArray(msg.content)) continue;

    // assistant с tool_use блоками → OpenAI tool_calls
    if (msg.role === "assistant") {
      const textParts = msg.content.filter((b: any) => b.type === "text");
      const toolUses  = msg.content.filter((b: any) => b.type === "tool_use");

      if (toolUses.length > 0) {
        messages.push({
          role:       "assistant",
          content:    textParts.map((b: any) => b.text).join("\n") || null,
          tool_calls: toolUses.map((b: any) => ({
            id:       b.id,
            type:     "function" as const,
            function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
          })),
        });
      } else {
        messages.push({
          role:    "assistant",
          content: textParts.map((b: any) => b.text).join("\n"),
        });
      }
      continue;
    }

    // user с tool_result блоками → OpenAI tool messages
    if (msg.role === "user") {
      const toolResults = msg.content.filter((b: any) => b.type === "tool_result");
      const textParts   = msg.content.filter((b: any) => b.type === "text");

      // tool results идут как отдельные messages с role: "tool"
      for (const b of toolResults) {
        const content = Array.isArray(b.content)
          ? b.content.map((c: any) => c.text ?? "").join("\n")
          : (b.content ?? "");
        messages.push({ role: "tool", tool_call_id: b.tool_use_id, content });
      }

      // обычный текст юзера
      if (textParts.length > 0) {
        messages.push({
          role:    "user",
          content: textParts.map((b: any) => b.text).join("\n"),
        });
      }
      continue;
    }
  }

  return messages;
}

// ─────────────────────────────────────────────────────────────
// Tool-calling loop
// ─────────────────────────────────────────────────────────────
async function runToolLoop(
  llm:      OpenAI,
  payload:  any,
  tools:    OpenAI.Chat.ChatCompletionTool[],
): Promise<OpenAI.Chat.ChatCompletion> {
  const messages = [...payload.messages] as OpenAI.Chat.ChatCompletionMessageParam[];
  let iterations = 0;

  while (true) {
    if (iterations >= MAX_ITERATIONS) {
      console.warn(`[agent] Лимит итераций (${MAX_ITERATIONS}) — финальный вызов без tools`);
      return llm.chat.completions.create({ ...payload, messages, stream: false });
    }

    iterations++;
    console.log(`[agent] Итерация ${iterations}/${MAX_ITERATIONS}`);

    const res = await llm.chat.completions.create({
      ...payload,
      messages,
      tools,
      tool_choice: "auto",
      stream:      false,
    });

    const message      = res.choices[0]?.message;
    const finishReason = res.choices[0]?.finish_reason;

    if (!message) return res;

    // Нет tool_calls — финальный ответ основной модели
    if (!message?.tool_calls?.length || finishReason === "stop") {
      console.log(`[agent] Завершён за ${iterations} итерацию(й)`);
      return res;
    }

    messages.push(message);

    // Выполняем все tool_calls параллельно
    const toolResults = await Promise.all(
      message.tool_calls
        .filter((call): call is OpenAI.Chat.ChatCompletionMessageToolCall & { "type": "function" } =>
          call.type === "function"
        )
        .map(async (call) => {
          let args: Record<string, any> = {};
          try {
            args = JSON.parse(call.function.arguments);
          } catch {
            console.error(`[agent] Не удалось распарсить аргументы: ${call.function.arguments}`);
          }

          console.log(`[agent] → ${call.function.name}(${JSON.stringify(args)})`);
          const result = await executeTool(call.function.name, args);

          return {
            role:         "tool" as const,
            tool_call_id: call.id,
            content:      result,
          };
        })
    );

    messages.push(...toolResults);
  }
}

// ─────────────────────────────────────────────────────────────
// runAgent — единая точка входа из index.ts
//
// Делает всё:
//   1. Препроцессинг сообщений (картинки → текст, файлы → контент)
//   2. Конвертация Anthropic → OpenAI формат
//   3. Tool loop (web_search, describe_image)
// ─────────────────────────────────────────────────────────────
export async function runAgent(
  llm:  OpenAI,
  body: any,
): Promise<OpenAI.Chat.ChatCompletion> {
  // 1. Препроцессинг
  const processedMessages = await preprocessMessages(body.messages ?? []);

  // 2. Конвертация форматов
  const messages = toOpenAIMessages(body, processedMessages);

  const payload = {
    model:       body.model,
    messages,
    max_tokens:  body.max_tokens  ?? 4096,
    temperature: body.temperature,
    top_p:       body.top_p,
    stop:        body.stop_sequences,
  };

  // 3. Собираем активные тулы
  const tools = buildTools();

  // Нет тулов — обычный вызов без loop
  if (tools.length === 0) {
    return llm.chat.completions.create({ ...payload, stream: false });
  }

  return runToolLoop(llm, payload, tools);
}