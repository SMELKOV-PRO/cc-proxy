# cc-proxy

> A local proxy server that connects Claude Code to any OpenAI-compatible API — with vision, web search, and file injection built in.

**[English](#english) · [Русский](#русский)**

---

## English

### What is this?

Claude Code is hardwired to the Anthropic API. This proxy sits between Claude Code and any OpenAI-compatible endpoint (OpenRouter, DeepSeek, local Ollama, etc.), transparently translating the protocol and adding capabilities the upstream model may lack.

```
Claude Code  →  cc-proxy (localhost)  →  OpenRouter / DeepSeek / Ollama / ...
```

### Features

- **Any OpenAI-compatible backend** — OpenRouter, DeepSeek, Groq, Ollama, or any custom endpoint
- **Vision support** — image blocks in messages are automatically described by a dedicated vision model before being sent to the main model
- **Web search** — the main model can call a `web_search` tool backed by Tavily, Serper, or Perplexity Sonar (via OpenRouter)
- **File injection** — file paths mentioned in messages are automatically read and injected as context
- **MCP compatible** — Claude Code's MCP tool calls pass through correctly with full `tool_use` / `tool_result` conversion
- **Streaming** — full SSE streaming support
- **Iteration limit** — agent loop is capped at `AGENT_MAX_ITERATIONS` to prevent runaway tool calls

### Architecture

```
index.ts        — Bun HTTP server, thin router
agent.ts        — unified entry point: preprocessing → format conversion → tool loop
vision.ts       — image description via a dedicated vision model
search.ts       — web search: Tavily / Serper / Sonar
anthropic-sse.ts — OpenAI response → Anthropic SSE format conversion
config.ts       — all configuration from environment variables
```

### Requirements

- [Bun](https://bun.sh) 1.0+
- An OpenAI-compatible API key (OpenRouter recommended)

### Installation

```bash
git clone https://github.com/SMELKOV-PRO/cc-proxy
cd cc-proxy
bun install
```

### Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

#### Core settings

```env
PORT=3099

# Main LLM endpoint (any OpenAI-compatible API)
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-...
```

#### Vision model (optional)

Used to describe images before sending to the main model.
Disable if your main model already supports vision.

```env
VISION_ENABLED=true
VISION_BASE_URL=https://openrouter.ai/api/v1
VISION_API_KEY=sk-or-...
VISION_MODEL=google/gemini-flash-1.5
```

#### Web search (optional)

The main model decides when to call `web_search` via tool calling.

```env
SEARCH_ENABLED=false
SEARCH_PROVIDER=tavily         # tavily | serper | sonar

# Tavily (https://tavily.com)
SEARCH_API_KEY=tvly-...
SEARCH_MAX_RESULTS=3

# Serper (https://serper.dev)
# SEARCH_API_KEY=...
# SEARCH_SERPER_COUNTRY=us
# SEARCH_SERPER_LANG=en

# Sonar via OpenRouter — uses the same ENDPOINT_* credentials, no extra key needed
# SEARCH_SONAR_MODEL=perplexity/sonar
```

#### Agent loop

```env
AGENT_MAX_ITERATIONS=5   # max tool call rounds before forcing a final answer
FILE_INJECT=true         # inject file contents when paths are mentioned in messages
```

### Running

```bash
bun run src/index.ts
```

### Connect Claude Code

```bash
claude config set api.baseUrl http://127.0.0.1:3099
claude config set api.key any-string
```

Set the models Claude Code should use (must match model IDs your endpoint accepts):

```bash
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek/deepseek-chat
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek/deepseek-chat
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek/deepseek-r1
export ANTHROPIC_MODEL=deepseek/deepseek-chat
```

Or put them in your shell profile (`~/.zshrc`, `~/.bashrc`, PowerShell `$PROFILE`).

### Docker

```bash
# Build
docker build -t cc-proxy .

# Run with env file
docker run --rm -p 3099:3099 --env-file .env -e PORT=3099 -e BIND_HOST=0.0.0.0 cc-proxy

# Or with compose
docker compose up -d
```

### Health check

```bash
curl http://127.0.0.1:3099/health
```

```json
{
  "status": "ok",
  "endpoint": "https://openrouter.ai/api/v1",
  "vision": "google/gemini-flash-1.5",
  "search": "tavily"
}
```

### How web search works

The main model is always the one you configured. When search is enabled, `web_search` is added as a tool. The model decides autonomously whether to call it — the proxy executes the search, returns the results as a tool result, and the model produces the final answer. The search provider (Tavily, Serper, or Sonar) is just an implementation detail invisible to the model.

```
User message
     ↓
Main model (decides to search)
     ↓
web_search("query") → Tavily / Serper / Sonar API
     ↓
Results → back to main model
     ↓
Final answer
```

### MCP support

MCP servers are managed by Claude Code, not the proxy. Claude Code injects MCP tool definitions into every `/v1/messages` request, executes the tools locally when the model calls them, and sends results back. The proxy only needs to correctly convert `tool_use` / `tool_result` Anthropic blocks to OpenAI format — which it does.

---

## Русский

### Что это?

Claude Code жёстко привязан к Anthropic API. Этот прокси встаёт между Claude Code и любым OpenAI-совместимым endpoint'ом — OpenRouter, DeepSeek, локальным Ollama и т.д., прозрачно транслирует протокол и добавляет возможности, которых у основной модели может не быть.

```
Claude Code  →  cc-proxy (localhost)  →  OpenRouter / DeepSeek / Ollama / ...
```

### Возможности

- **Любой OpenAI-совместимый бэкенд** — OpenRouter, DeepSeek, Groq, Ollama или любой кастомный endpoint
- **Поддержка изображений** — блоки с картинками автоматически описываются отдельной vision-моделью перед отправкой основной модели
- **Поиск в интернете** — основная модель может вызвать тул `web_search` через Tavily, Serper или Perplexity Sonar (через OpenRouter)
- **Инжекция файлов** — пути к файлам в сообщениях автоматически читаются и вставляются как контекст
- **MCP-совместимость** — tool_use / tool_result блоки от MCP-серверов Claude Code корректно конвертируются
- **Стриминг** — полная поддержка SSE
- **Лимит итераций** — agent loop ограничен `AGENT_MAX_ITERATIONS` на случай зависания

### Архитектура

```
index.ts         — Bun HTTP сервер, тонкий роутер
agent.ts         — единая точка входа: препроцессинг → конвертация форматов → tool loop
vision.ts        — описание изображений через отдельную vision-модель
search.ts        — веб-поиск: Tavily / Serper / Sonar
anthropic-sse.ts — конвертация OpenAI ответа в Anthropic SSE формат
config.ts        — вся конфигурация из переменных окружения
```

### Требования

- [Bun](https://bun.sh) 1.0+
- API-ключ для OpenAI-совместимого сервиса (рекомендуется OpenRouter)

### Установка

```bash
git clone https://github.com/SMELKOV-PRO/cc-proxy
cd cc-proxy
bun install
```

### Конфигурация

Скопируй `.env.example` в `.env` и заполни значения:

```bash
cp .env.example .env
```

#### Основные настройки

```env
PORT=3099

# Основной LLM endpoint (любой OpenAI-совместимый API)
OPENAI_BASE_URL=https://openrouter.ai/api/v1
OPENAI_API_KEY=sk-or-...
```

#### Vision-модель (опционально)

Используется для описания изображений перед отправкой основной модели.
Отключи если основная модель уже поддерживает vision.

```env
VISION_ENABLED=true
VISION_BASE_URL=https://openrouter.ai/api/v1
VISION_API_KEY=sk-or-...
VISION_MODEL=google/gemini-flash-1.5
```

#### Веб-поиск (опционально)

Основная модель сама решает когда вызывать `web_search` через tool calling.

```env
SEARCH_ENABLED=false
SEARCH_PROVIDER=tavily         # tavily | serper | sonar

# Tavily (https://tavily.com)
SEARCH_API_KEY=tvly-...
SEARCH_MAX_RESULTS=3

# Serper (https://serper.dev)
# SEARCH_API_KEY=...
# SEARCH_SERPER_COUNTRY=ru
# SEARCH_SERPER_LANG=ru

# Sonar через OpenRouter — использует те же ENDPOINT_* ключи, отдельный ключ не нужен
# SEARCH_SONAR_MODEL=perplexity/sonar
```

#### Agent loop

```env
AGENT_MAX_ITERATIONS=5   # максимум раундов tool calling до принудительного финального ответа
FILE_INJECT=true         # инжектировать содержимое файлов когда пути упоминаются в сообщениях
```

### Запуск

```bash
bun run src/index.ts
```

### Подключить Claude Code

```bash
claude config set api.baseUrl http://127.0.0.1:3099
claude config set api.key any-string
```

Задать модели которые будет использовать Claude Code (должны соответствовать слагам твоего endpoint'а):

```bash
export ANTHROPIC_DEFAULT_HAIKU_MODEL=deepseek/deepseek-chat
export ANTHROPIC_DEFAULT_SONNET_MODEL=deepseek/deepseek-chat
export ANTHROPIC_DEFAULT_OPUS_MODEL=deepseek/deepseek-r1
export ANTHROPIC_MODEL=deepseek/deepseek-chat
```

Или добавь в профиль шелла (`~/.zshrc`, `~/.bashrc`, PowerShell `$PROFILE`).

### Docker

```bash
# Сборка
docker build -t cc-proxy .

# Запуск с .env
docker run --rm -p 3099:3099 --env-file .env -e PORT=3099 -e BIND_HOST=0.0.0.0 cc-proxy

# Или через compose
docker compose up -d
```

### Проверка работы

```bash
curl http://127.0.0.1:3099/health
```

```json
{
  "status": "ok",
  "endpoint": "https://openrouter.ai/api/v1",
  "vision": "google/gemini-flash-1.5",
  "search": "tavily"
}
```

### Как работает поиск

Основная модель всегда та, что ты настроил. При включённом поиске в запрос добавляется тул `web_search`. Модель сама решает когда его вызвать — прокси выполняет поиск, возвращает результаты как tool result, и модель формирует финальный ответ. Провайдер (Tavily, Serper или Sonar) — деталь реализации, невидимая модели.

```
Сообщение пользователя
        ↓
Основная модель (решает искать)
        ↓
web_search("запрос") → Tavily / Serper / Sonar API
        ↓
Результаты → обратно в основную модель
        ↓
Финальный ответ
```

### MCP

MCP-серверы управляются Claude Code, а не прокси. Claude Code сам инжектирует описания MCP-тулов в каждый запрос `/v1/messages`, сам выполняет тулы локально когда модель их вызывает, и отправляет результаты обратно. Прокси только корректно конвертирует `tool_use` / `tool_result` блоки Anthropic в формат OpenAI.

---

## License

MIT © 2026 [Sergei Smelkov](https://github.com/SMELKOV-PRO)
