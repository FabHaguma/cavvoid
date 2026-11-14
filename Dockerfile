# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-bookworm-slim
ARG NGINX_IMAGE=nginx:stable-alpine

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --include=dev
COPY frontend ./frontend
COPY shared ./shared
COPY scripts/pwa-build.js ./scripts/pwa-build.js
COPY vite.config.js ./
RUN npm run build

FROM ${NODE_IMAGE} AS backend
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY backend ./backend
COPY shared ./shared
COPY scripts/verify-data.js ./scripts/verify-data.js
COPY scripts/healthcheck.js ./scripts/healthcheck.js
# File storage checks resolve the public root even though Nginx owns the UI.
RUN mkdir -p /app/frontend /data && chown node:node /data
USER node
EXPOSE 3001
CMD ["node", "backend/server.js"]

FROM ${NGINX_IMAGE} AS frontend
COPY --from=build /app/frontend/dist /usr/share/nginx/html
COPY deploy/nginx.conf.template /etc/nginx/templates/cavvoid.conf.template
COPY deploy/nginx-security-headers.conf /etc/nginx/cavvoid-security-headers.conf
COPY deploy/frontend-entrypoint.sh /usr/local/bin/cavvoid-entrypoint
RUN chmod 755 /usr/local/bin/cavvoid-entrypoint
EXPOSE 80
ENTRYPOINT ["/usr/local/bin/cavvoid-entrypoint"]
