// ─────────────────────────────────────────────────────────────
// Конвертация OpenAI → Anthropic формат
// Для обычных ответов и для SSE стриминга
// ─────────────────────────────────────────────────────────────

// ── Обычный ответ ──────────────────────────────────────────
export function toAnthropicResponse(openAIRes: any, model: string): any {
  const choice = openAIRes.choices?.[0];
  return {
    id:           openAIRes.id ?? `msg_${Date.now()}`,
    type:         "message",
    role:         "assistant",
    model,
    content:      [{ type: "text", text: choice?.message?.content ?? "" }],
    stop_reason:  choice?.finish_reason === "stop" ? "end_turn" : (choice?.finish_reason ?? "end_turn"),
    stop_sequence: null,
    usage: {
      input_tokens:  openAIRes.usage?.prompt_tokens     ?? 0,
      output_tokens: openAIRes.usage?.completion_tokens ?? 0,
    },
  };
}

// ── SSE хелпер ─────────────────────────────────────────────
function sse(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

// ── Стриминг: OpenAI AsyncIterable → Anthropic SSE ReadableStream ──
export function toAnthropicStream(openAIStream: AsyncIterable<any>, model: string): ReadableStream {
  return new ReadableStream({
    async start(controller) {
      const enc  = new TextEncoder();
      const send = (event: string, data: object) =>
        controller.enqueue(enc.encode(sse(event, data)));

      const msgId = `msg_${Date.now()}`;

      // ── Старт сообщения ──
      send("message_start", {
        type: "message_start",
        message: {
          id: msgId, type: "message", role: "assistant", model,
          content: [], usage: { input_tokens: 0, output_tokens: 0 },
        },
      });

      send("content_block_start", {
        type: "content_block_start", index: 0,
        content_block: { type: "text", text: "" },
      });

      send("ping", { type: "ping" });

      // ── Чанки ──
      let outputTokens = 0;

      try {
        for await (const chunk of openAIStream) {
          const delta = chunk.choices?.[0]?.delta?.content;
          if (delta) {
            outputTokens++;
            send("content_block_delta", {
              type: "content_block_delta", index: 0,
              delta: { type: "text_delta", text: delta },
            });
          }
        }
      } catch (err) {
        console.error("[stream] Ошибка при чтении стрима:", err);
      }

      // ── Завершение ──
      send("content_block_stop",  { type: "content_block_stop", index: 0 });
      send("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: outputTokens },
      });
      send("message_stop", { type: "message_stop" });

      controller.close();
    },
  });
}