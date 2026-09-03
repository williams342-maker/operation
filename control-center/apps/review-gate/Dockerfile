# Review gate service. Built, not deployed — deployment is a separate owner decision.
FROM node:22-alpine AS build
WORKDIR /srv
COPY package.json tsconfig.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm install --no-save typescript@^5.7.2
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-alpine
WORKDIR /srv
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY --from=build /srv/dist ./dist
# Not a public service: bind to a private interface and put no ingress in front of it.
USER node
CMD ["node", "dist/server.js"]
