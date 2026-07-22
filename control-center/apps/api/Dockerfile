# syntax=docker/dockerfile:1.7
FROM node:22-alpine AS build
WORKDIR /app
ARG SOURCE_COMMIT
RUN test -n "$SOURCE_COMMIT" && test ${#SOURCE_COMMIT} -eq 40
RUN apk add --no-cache tar
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace @control-center/shared
RUN npm run build --workspace @control-center/agent
RUN npm run build --workspace @control-center/api
RUN mkdir -p /artifact/control-center/apps /artifact/control-center/packages && \
    cp package.json package-lock.json /artifact/control-center/ && \
    cp -a apps/agent /artifact/control-center/apps/agent && \
    cp -a packages/shared /artifact/control-center/packages/shared && \
    printf '%s\n' "$SOURCE_COMMIT" >/artifact/control-center/.opsworkbench-source-commit && \
    tar --sort=name --mtime='UTC 1970-01-01' --owner=0 --group=0 --numeric-owner -czf /artifact/opsworkbench-agent-source.tar.gz -C /artifact control-center
RUN npm prune --omit=dev --workspaces --include-workspace-root

FROM node:22-alpine AS runtime
ARG SOURCE_COMMIT
LABEL org.opencontainers.image.revision=$SOURCE_COMMIT
ENV NODE_ENV=production
ENV CONTROL_CENTER_SOURCE_COMMIT=$SOURCE_COMMIT
ENV CONTROL_CENTER_AGENT_ARTIFACT_PATH=/app/artifacts/opsworkbench-agent-source.tar.gz
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/package.json /app/package-lock.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=app:app /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=app:app /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=app:app /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=app:app /artifact/opsworkbench-agent-source.tar.gz ./artifacts/opsworkbench-agent-source.tar.gz
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
