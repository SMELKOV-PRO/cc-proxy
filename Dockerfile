FROM oven/bun:1.3.11-slim

WORKDIR /app

COPY package.json bun.lock tsconfig.json ./
RUN bun install --frozen-lockfile

COPY src ./src

EXPOSE 3099

ENV NODE_ENV=production

RUN chown -R bun:bun /app
USER bun

CMD ["bun","run","src/index.ts"]
