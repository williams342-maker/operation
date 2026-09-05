# syntax=docker/dockerfile:1.7
FROM node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS build
WORKDIR /app
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY . .
RUN npm run build --workspace @control-center/shared
RUN npm run build --workspace @control-center/web

# Build provenance (Forge milestone 5 - see docs/forge-manifest-spec.md section 2.1).
# SOURCE_COMMIT is REQUIRED. Validated at the END of the build stage on purpose: declaring the ARG
# earlier would invalidate the npm ci layer on every commit, and validating in the runtime stage would
# add a layer to the shipped image. An image that cannot say what it was built from should not exist,
# so the build fails rather than emitting a placeholder - a vague label is vague exactly when it matters.
ARG SOURCE_COMMIT
RUN printf '%s' "$SOURCE_COMMIT" | grep -Eq '^[0-9a-f]{40}$' || { echo "SOURCE_COMMIT build-arg is required and must be a 40-character lowercase commit sha." >&2; echo '  docker build --build-arg SOURCE_COMMIT="$(git rev-parse HEAD)" --build-arg SOURCE_TREE="$(git rev-parse HEAD^{tree})" ...' >&2; exit 1; }

FROM nginx:1.27-alpine@sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10 AS runtime

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
LABEL org.opencontainers.image.title="opsworkbench-control-center-web"
LABEL org.opsworkbench.source.tree="$SOURCE_TREE"
COPY deploy/nginx/web.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1
