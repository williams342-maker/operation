# syntax=docker/dockerfile:1.7
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace @control-center/shared
RUN npm run build --workspace @control-center/api
RUN npm prune --omit=dev --workspaces --include-workspace-root

# Build provenance (Forge milestone 5 - see docs/forge-manifest-spec.md section 2.1).
# SOURCE_COMMIT is REQUIRED. Validated at the END of the build stage on purpose: declaring the ARG
# earlier would invalidate the npm ci layer on every commit, and validating in the runtime stage would
# add a layer to the shipped image. An image that cannot say what it was built from should not exist,
# so the build fails rather than emitting a placeholder - a vague label is vague exactly when it matters.
ARG SOURCE_COMMIT
RUN printf '%s' "$SOURCE_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || { echo "SOURCE_COMMIT build-arg is required and must be a 40-character lowercase commit sha." >&2; echo '  docker build --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" --build-arg SOURCE_TREE="$(git rev-parse HEAD^{tree})" ...' >&2; exit 1; }

FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS runtime

# org.opencontainers.image.revision is the label the deployment preflight already reads
# (defaultInspectImage in apps/agent/src/betaDeploymentPreflight.ts) and which, until now, was
# collected and never compared against anything. It is what forge_build_provenance checks.
ARG SOURCE_COMMIT
ARG SOURCE_TREE=""
ARG SOURCE_REPOSITORY="https://github.com/williams342-maker/operation"
ARG SOURCE_TAG=""
ARG BUILD_CREATED=""
LABEL org.opencontainers.image.revision="$SOURCE_COMMIT"
LABEL org.opencontainers.image.source="$SOURCE_REPOSITORY"
LABEL org.opencontainers.image.version="$SOURCE_TAG"
LABEL org.opencontainers.image.created="$BUILD_CREATED"
LABEL org.opencontainers.image.title="opsworkbench-control-center-api"
LABEL org.opsworkbench.source.tree="$SOURCE_TREE"
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=build --chown=app:app /app/package.json /app/package-lock.json ./
COPY --from=build --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=build --chown=app:app /app/packages/shared/dist ./packages/shared/dist
COPY --from=build --chown=app:app /app/apps/api/package.json ./apps/api/package.json
COPY --from=build --chown=app:app /app/apps/api/dist ./apps/api/dist
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/api/dist/server.js"]
