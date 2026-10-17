FROM caddy:2-alpine
RUN apk add --no-cache curl
RUN mkdir -p /data /config && chown -R 1000:1000 /data /config
USER 1000:1000
COPY infra/Caddyfile /etc/caddy/Caddyfile
