import OpenAI    from "openai";
import { config } from "./config";

// Тот же endpoint что и основная модель (OpenRouter или любой OpenAI-совместимый)
const llm = new OpenAI({
  baseURL: config.endpoint.baseUrl,
  apiKey:  config.endpoint.apiKey,
});

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
interface SearchResult {
  title:   string;
  url:     string;
  snippet: string;
}

interface SearchResponse {
  answer?:  string;
  results:  SearchResult[];
}

function formatResults(r: SearchResponse): string {
  const lines: string[] = [];

  if (r.answer) lines.push(`Direct answer: ${r.answer}`, "");

  r.results.forEach((item, i) => {
    lines.push(`[${i + 1}] ${item.title}`);
    if (item.url) lines.push(`    URL: ${item.url}`);
    lines.push(`    ${item.snippet}`, "");
  });

  return lines.length > 0 ? lines.join("\n").trim() : "No results found.";
}

// ─────────────────────────────────────────────────────────────
// Tavily
// ─────────────────────────────────────────────────────────────
async function searchTavily(query: string): Promise<string> {
  const res = await fetch("https://api.tavily.com/search", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key:        config.search.apiKey,
      query,
      max_results:    config.search.maxResults,
      include_answer: true,
      search_depth:   "basic",
    }),
  });

  if (!res.ok) throw new Error(`Tavily ${res.status}: ${await res.text()}`);

  const data = await res.json() as any;
  return formatResults({
    answer:  data.answer,
    results: (data.results ?? []).map((r: any) => ({
      title:   r.title   ?? "",
      url:     r.url     ?? "",
      snippet: r.content ?? "",
    })),
  });
}

// ─────────────────────────────────────────────────────────────
// Serper
// ─────────────────────────────────────────────────────────────
async function searchSerper(query: string): Promise<string> {
  const res = await fetch("https://google.serper.dev/search", {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY":    config.search.apiKey,
    },
    body: JSON.stringify({
      q:   query,
      num: config.search.maxResults,
      gl:  config.search.serperCountry ?? "us",
      hl:  config.search.serperLang    ?? "en",
    }),
  });

  if (!res.ok) throw new Error(`Serper ${res.status}: ${await res.text()}`);

  const data    = await res.json() as any;
  const results: SearchResult[] = (data.organic ?? []).map((r: any) => ({
    title:   r.title   ?? "",
    url:     r.link    ?? "",
    snippet: r.snippet ?? "",
  }));

  if (data.knowledgeGraph?.description) {
    results.unshift({
      title:   data.knowledgeGraph.title ?? "Knowledge Graph",
      url:     data.knowledgeGraph.website ?? "",
      snippet: data.knowledgeGraph.description,
    });
  }

  return formatResults({
    answer:  data.answerBox?.answer ?? data.answerBox?.snippet,
    results,
  });
}

// ─────────────────────────────────────────────────────────────
// Sonar — через OpenRouter (тот же llm клиент, другой model slug)
// Результат идёт обратно в основную модель как tool result
// ─────────────────────────────────────────────────────────────
async function searchSonar(query: string): Promise<string> {
  const res = await llm.chat.completions.create({
    model:      config.search.sonarModel ?? "perplexity/sonar",
    max_tokens: 1024,
    messages: [
      {
        role:    "system",
        content: "You are a search assistant. Return factual information with sources. Be concise.",
      },
      { role: "user", content: query },
    ],
  });

  return res.choices[0]?.message?.content ?? "No results.";
}

// ─────────────────────────────────────────────────────────────
// Публичный интерфейс
// Все провайдеры возвращают строку → tool result основной модели
// ─────────────────────────────────────────────────────────────
export async function webSearch(query: string): Promise<string> {
  const { provider } = config.search;
  console.log(`[search:${provider}] "${query}"`);

  try {
    switch (provider) {
      case "tavily": return await searchTavily(query);
      case "serper": return await searchSerper(query);
      case "sonar":  return await searchSonar(query);
      default:
        return `Search provider "${provider}" is not configured.`;
    }
  } catch (e: any) {
    console.error(`[search:${provider}] Error:`, e?.message);
    return `Search failed (${provider}): ${e?.message ?? "unknown error"}`;
  }
}