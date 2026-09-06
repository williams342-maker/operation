# syntax=docker/dockerfile:1.7
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/review-gate/package.json apps/review-gate/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace @control-center/shared
RUN npm run build --workspace @control-center/review-gate
RUN npm prune --omit=dev --workspaces --include-workspace-root
ARG SOURCE_COMMIT
RUN printf '%s' "$SOURCE_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || { echo "SOURCE_COMMIT build-arg is required." >&2; exit 1; }

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runtime
ARG SOURCE_COMMIT
ARG SOURCE_TREE=""
ARG SOURCE_REPOSITORY="https://github.com/williams342-maker/operation"
ARG SOURCE_TAG=""
ARG BUILD_CREATED=""
LABEL org.opencontainers.image.revision="$SOURCE_COMMIT"
LABEL org.opencontainers.image.source="$SOURCE_REPOSITORY"
LABEL org.opencontainers.image.version="$SOURCE_TAG"
LABEL org.opencontainers.image.created="$BUILD_CREATED"
LABEL org.opencontainers.image.title="opsworkbench-review-gate"
LABEL org.opsworkbench.source.tree="$SOURCE_TREE"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json /app/package-lock.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=node:node /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=node:node /app/apps/review-gate/package.json ./apps/review-gate/package.json
COPY --from=build --chown=node:node /app/apps/review-gate/dist ./apps/review-gate/dist
USER node
EXPOSE 3100
HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=4 CMD node -e "const p=process.env.REVIEW_GATE_TLS_CERTIFICATE_PATH;if(!p){fetch('http://127.0.0.1:3100/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1));}else{const fs=require('fs'),https=require('https');https.get({host:'127.0.0.1',port:3100,path:'/healthz',ca:fs.readFileSync(p),servername:'review-gate',rejectUnauthorized:true},r=>process.exit(r.statusCode>=200&&r.statusCode<300?0:1)).on('error',()=>process.exit(1));}"
CMD ["node", "apps/review-gate/dist/server.js"]
