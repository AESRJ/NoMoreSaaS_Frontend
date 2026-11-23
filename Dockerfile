# syntax=docker/dockerfile:1
# Imagen de producción de NoMoreSaaS: Express sirve la API y la SPA compilada
# en el mismo origen. Node y pnpm fijados; sin .env, DB local ni secretos.
ARG NODE_IMAGE=node:26.13.1-bookworm-slim

FROM ${NODE_IMAGE} AS base
WORKDIR /app
# Node 25+ ya no incluye corepack: pnpm se instala con versión exacta.
RUN npm install --global pnpm@12.21.0 && npm cache clean --force
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
RUN pnpm build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @nomoresaas/api

FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    DATABASE_PATH=/data/nomoresaas/production.sqlite
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json ./
COPY apps/api/package.json apps/api/
COPY apps/api/src apps/api/src
COPY apps/api/data apps/api/data
COPY apps/api/migrations apps/api/migrations
COPY --from=build /app/apps/web/dist apps/web/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod 0755 /usr/local/bin/docker-entrypoint.sh
EXPOSE 8080
ENTRYPOINT ["docker-entrypoint.sh"]
