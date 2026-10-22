FROM node:24-alpine AS build

WORKDIR /app

# Docker serves the web UI; the native Electron binary is only needed on the host.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run typecheck && npm test && npm run build

FROM node:24-alpine AS api

WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001
COPY --chown=node:node server ./server
COPY --chown=node:node shared ./shared
COPY --chown=node:node package.json ./
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "server/start.ts"]

FROM nginx:stable-alpine AS web

COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=10s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1
