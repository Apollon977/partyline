FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY src/core ./src/core
COPY src/node ./src/node

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://localhost:8787/ >/dev/null || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "src/node/server.ts"]
