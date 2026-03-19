import OpenAI from "openai";
import { config }                                from "./config";
import { toAnthropicResponse, toAnthropicStream } from "./anthropic-sse";
import { runAgent }                              from "./agent";

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function err(message: string, status = 400): Response {
  return json({ type: "error", error: { type: "invalid_request_error", message } }, status);
}

function textToAnthropicStream(text: string, model: string): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    start(controller) {
      const send = (event: string, data: object) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
        );
      };

      // Anthropic SSE протокол
      send("message_start", {
        type: "message_start",
        message: {
          id:            `msg_${Date.now()}`,
          type:          "message",
          role:          "assistant",
          model,
          content:       [],
          stop_reason:   null,
          stop_sequence: null,
          usage:         { input_tokens: 0, output_tokens: 0 },
        },
      });

      send("content_block_start", {
        type:          "content_block_start",
        index:         0,
        content_block: { type: "text", text: "" },
      });

      // Бьём на чанки по ~20 символов
      const chunkSize = 20;
      for (let i = 0; i < text.length; i += chunkSize) {
        send("content_block_delta", {
          type:  "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: text.slice(i, i + chunkSize) },
        });
      }

      send("content_block_stop", { type: "content_block_stop", index: 0 });

      send("message_delta", {
        type:  "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: Math.ceil(text.length / 4) },
      });

      send("message_stop", { type: "message_stop" });

      controller.close();
    },
  });
}

// ─────────────────────────────────────────────────────────────
// POST /v1/messages
// ─────────────────────────────────────────────────────────────
async function handleMessages(req: Request): Promise<Response> {
  const body   = await req.json() as any;
  const model  = body.model;
  const stream = !!body.stream;

  const llm = new OpenAI({
    baseURL: config.endpoint.baseUrl,
    apiKey:  config.endpoint.apiKey,
  });

  try {
    const res = await runAgent(llm, body);

    if (!stream) {
      return json(toAnthropicResponse(res, model));
    }

    // Финальный текст уже есть — стримим его напрямую без второго API-вызова
    const finalContent = res.choices[0]?.message?.content ?? "";
    const anthropicStream = textToAnthropicStream(finalContent, model);

    return new Response(anthropicStream, {
      headers: {
        "Content-Type":  "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection":    "keep-alive",
      },
    });

  } catch (e: any) {
    console.error("[proxy] Ошибка LLM:", e?.message);
    return err(e?.message ?? "LLM error", 502);
  }
}

// ─────────────────────────────────────────────────────────────
// GET /v1/models
// ─────────────────────────────────────────────────────────────
function handleModels(): Response {
  const models = [
    "claude-haiku-4-5-20251001",
    "claude-sonnet-4-5-20251001",
    "claude-opus-4-5-20251001",
  ].map(id => ({
    type:         "model",
    id,
    display_name: id,
    created_at:   "2024-01-01T00:00:00Z",
  }));
  return json({ data: models });
}

// ─────────────────────────────────────────────────────────────
// Bun.serve
// ─────────────────────────────────────────────────────────────
Bun.serve({
  port:     config.port,
  hostname: "127.0.0.1",

  async fetch(req) {
    const { pathname } = new URL(req.url);
    const method       = req.method;

    if (method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin":  "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key, anthropic-version",
        },
      });
    }

    if (pathname === "/v1/messages" && method === "POST")
      return handleMessages(req);

    if (pathname === "/v1/messages/count_tokens" && method === "POST") {
      const body = await req.json() as any;
      const text = JSON.stringify(body.messages ?? "");
      return json({ input_tokens: Math.ceil(text.length / 4) });
    }

    if (pathname === "/v1/models" && method === "GET")
      return handleModels();

    if (pathname === "/health" && method === "GET")
      return json({
        status:   "ok",
        endpoint: config.endpoint.baseUrl,
        vision:   config.visionModel.enabled ? config.visionModel.model : "disabled",
        search:   config.search.enabled ? config.search.provider : "disabled",
      });

    return err("Not found", 404);
  },
});

console.log(`
✅  CC Proxy запущен на http://127.0.0.1:${config.port}

  Endpoint : ${config.endpoint.baseUrl}
  Vision   : ${config.visionModel.enabled ? config.visionModel.model : "отключён"}
  Поиск    : ${config.search.enabled ? config.search.provider : "отключён"}

  Модели:
    ANTHROPIC_DEFAULT_HAIKU_MODEL
    ANTHROPIC_DEFAULT_SONNET_MODEL
    ANTHROPIC_DEFAULT_OPUS_MODEL

  Подключить Claude Code:
    claude config set api.baseUrl http://127.0.0.1:${config.port}
    claude config set api.key any-key
`);
