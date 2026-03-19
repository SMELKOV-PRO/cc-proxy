// ─────────────────────────────────────────────────────────────
// Конфиг — всё берётся из переменных окружения
//
// Модели управляются нативными переменными Claude Code:
//   ANTHROPIC_DEFAULT_HAIKU_MODEL
//   ANTHROPIC_DEFAULT_SONNET_MODEL
//   ANTHROPIC_DEFAULT_OPUS_MODEL
//   ANTHROPIC_MODEL
//
// Прокси только пробрасывает body.model как есть на endpoint.
// Единственная своя переменная — VISION_MODEL.
// ─────────────────────────────────────────────────────────────

export const config = {
  port: parseInt(Bun.env.PORT ?? "3033"),

  // Endpoint куда пробрасываются все запросы
  endpoint: {
    baseUrl: Bun.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1",
    apiKey:  Bun.env.OPENAI_API_KEY  ?? "",
  },

  // Vision — единственная модель которую прокси контролирует сам
  visionModel: {
    enabled: Bun.env.VISION_ENABLED !== "false",  // включён по умолчанию
    baseUrl: Bun.env.VISION_BASE_URL ?? Bun.env.OPENAI_BASE_URL ?? "https://openrouter.ai/api/v1",
    apiKey:  Bun.env.VISION_API_KEY  ?? Bun.env.OPENAI_API_KEY  ?? "",
    model:   Bun.env.VISION_MODEL    ?? "google/gemini-2.5-flash",
  },

  search: {
    enabled:       Bun.env.SEARCH_ENABLED === "true",
    provider:      (Bun.env.SEARCH_PROVIDER ?? "none") as "none" | "tavily" | "serper" | "sonar",
    apiKey:        Bun.env.SEARCH_API_KEY ?? "",
    sonarModel:    Bun.env.SEARCH_SONAR_MODEL ?? "perplexity/sonar",
    maxResults:    Number(Bun.env.SEARCH_MAX_RESULTS ?? 3),
    serperCountry: Bun.env.SEARCH_SERPER_COUNTRY ?? "us",  // для локализации
    serperLang:    Bun.env.SEARCH_SERPER_LANG    ?? "en",
  },
} as const;
