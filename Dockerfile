# Auxiliary worker: only the allowlisted JavaScript PDF tools; no native engines.
FROM node:22-trixie-slim AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:22-trixie-slim
WORKDIR /app
ENV NODE_ENV=production
ENV PROCESSING_WORKER_ONLY=1
ENV PROCESSING_WORKER_TOOLS=juntar-pdf,dividir-pdf,girar-pdf,organizar-pdf,editar-metadados
ENV PROCESSING_WORKER_MAX_REQUEST_BYTES=8388608
ENV PORT=3000
COPY --from=build /app ./
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start", "--hostname", "0.0.0.0"]
