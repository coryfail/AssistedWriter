FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY vite.config.js index.html web.html ./
COPY src/ src/
COPY electron/relay-crypto.mjs electron/relay-origin.cjs electron/
COPY scripts/write-relay-config.cjs scripts/
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app/node_modules/ws node_modules/ws
COPY --from=build /app/dist dist
COPY electron/relay-origin.cjs electron/
COPY relay/server.cjs relay/
ENV NODE_ENV=production PORT=8080
USER node
EXPOSE 8080
CMD ["node", "relay/server.cjs"]
