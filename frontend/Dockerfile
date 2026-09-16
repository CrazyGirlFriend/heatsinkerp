ARG NODE_BASE_IMAGE=node:22-alpine
ARG NGINX_BASE_IMAGE=nginx:1.27-alpine
FROM ${NODE_BASE_IMAGE} AS build

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

COPY . .
RUN npm run build

FROM ${NGINX_BASE_IMAGE} AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
