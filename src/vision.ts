import OpenAI from "openai";
import { config } from "./config";

const visionClient = new OpenAI({
  baseURL: config.visionModel.baseUrl,
  apiKey:  config.visionModel.apiKey,
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
async function resolveImageUrl(url: string): Promise<{ base64: string; mediaType: string }> {
  if (url.startsWith("data:")) {
    const [meta, data] = url.split(",");
    return {
      base64:    data ?? "",
      mediaType: (meta ?? "data:image/png").replace("data:", "").replace(";base64", ""),
    };
  }
  const res = await fetch(url);
  const buf = await res.arrayBuffer();
  return {
    base64:    Buffer.from(buf).toString("base64"),
    mediaType: res.headers.get("content-type") ?? "image/png",
  };
}

// ─────────────────────────────────────────────────────────────
// describeImage — вызывается двумя способами:
//   1. Из preprocessMessages — для картинок в content блоках
//   2. Как agent tool — если модель явно просит describe_image
// ─────────────────────────────────────────────────────────────
export async function describeImage(base64: string, mediaType: string): Promise<string> {
  const res = await visionClient.chat.completions.create({
    model: config.visionModel.model,
    messages: [{
      role:    "user",
      content: [
        { type: "image_url", image_url: { url: `data:${mediaType};base64,${base64}` } },
        { type: "text", text: "Детально опиши изображение. Если есть текст, код или ошибки — процитируй точно." },
      ],
    }],
  });

  const description = res.choices[0]?.message.content ?? "";
  console.log(`[vision] Описано через ${config.visionModel.model}`);
  return description;
}

// ─────────────────────────────────────────────────────────────
// describeImageFromUrl — обёртка для agent tool
// принимает url или data:// строку
// ─────────────────────────────────────────────────────────────
export async function describeImageFromUrl(url: string): Promise<string> {
  try {
    const { base64, mediaType } = await resolveImageUrl(url);
    return describeImage(base64, mediaType);
  } catch (e: any) {
    return `Failed to describe image: ${e?.message ?? "unknown error"}`;
  }
}

// ─────────────────────────────────────────────────────────────
// preprocessImageBlocks — обрабатывает Anthropic content blocks
// до отправки в основную модель (она может не поддерживать vision)
// ─────────────────────────────────────────────────────────────
export async function preprocessImageBlocks(blocks: any[]): Promise<any[]> {
  return Promise.all(blocks.map(async (block) => {
    if (block.type !== "image") return block;

    const src = block.source;
    let base64: string;
    let mediaType: string;

    if (src.type === "base64") {
      base64    = src.data;
      mediaType = src.media_type;
    } else if (src.type === "url") {
      const resolved = await resolveImageUrl(src.url).catch(() => null);
      if (!resolved) return block;
      ({ base64, mediaType } = resolved);
    } else {
      return block;
    }

    const description = await describeImage(base64, mediaType);
    return { type: "text", text: `[Изображение: ${description}]` };
  }));
}
