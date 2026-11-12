# API server and worker share one image (TypeScript runs through tsx, as in development).
#   docker build -f ops/Dockerfile.app -t nomad-app .
#   API:    docker run nomad-app            (default command)
#   Worker: docker run nomad-app npm run start -w @nomad/worker
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/engine/package.json packages/engine/
COPY apps/server/package.json apps/server/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
# Dev dependencies stay: tsx (runtime) and typescript live in the root package.
RUN npx -y npm@11 ci

FROM node:22-alpine
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3010 UPLOADS_DIR=/data/uploads
WORKDIR /app
RUN addgroup -S nomad && adduser -S nomad -G nomad && mkdir -p /data/uploads && chown nomad:nomad /data/uploads
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY packages/shared packages/shared
COPY packages/engine packages/engine
COPY apps/server apps/server
COPY apps/worker apps/worker
USER nomad
EXPOSE 3010
HEALTHCHECK --interval=15s --timeout=3s --retries=5 CMD wget -qO- http://127.0.0.1:3010/api/live || exit 1
CMD ["sh", "-c", "npm run migrate -w @nomad/server && npm run start -w @nomad/server"]
