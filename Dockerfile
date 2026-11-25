# syntax=docker/dockerfile:1

FROM node:22-alpine AS web-build
WORKDIR /web
COPY web/package.json web/package-lock.json* ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM node:22-alpine AS server-build
WORKDIR /server
COPY server/package.json server/package-lock.json* ./
RUN npm ci
COPY server/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache su-exec
COPY server/package.json server/package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=server-build /server/dist ./dist
COPY --from=web-build /web/dist ./public
COPY docker-entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh && mkdir -p /app/data && chown node:node /app/data
VOLUME ["/app/data"]
EXPOSE 3000
# Start as root so the entrypoint can chown a host-mounted DATA_DIR, then drop to 'node'.
ENTRYPOINT ["/entrypoint.sh"]
CMD ["node", "dist/index.js"]
