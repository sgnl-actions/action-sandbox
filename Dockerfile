FROM debian:bookworm-slim AS deno-downloader
ARG DENO_VERSION=2.8.3
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends curl unzip ca-certificates \
    && ARCH=$(case ${TARGETARCH} in amd64) echo "x86_64" ;; arm64) echo "aarch64" ;; esac) \
    && curl -fsSL "https://github.com/denoland/deno/releases/download/v${DENO_VERSION}/deno-${ARCH}-unknown-linux-gnu.zip" -o /tmp/deno.zip \
    && unzip /tmp/deno.zip -d /usr/local/bin/ \
    && chmod +x /usr/local/bin/deno \
    && rm /tmp/deno.zip

FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY --from=deno-downloader /usr/local/bin/deno /usr/bin/deno

COPY shim/ /app/deno/

# Cache Deno dependencies (node: builtins need type resolution).
# Use --no-check to skip type checking — we only need runtime modules cached.
RUN deno cache --no-check /app/deno/mod.ts || true

COPY src/host/ /app/host/

WORKDIR /app
ENTRYPOINT ["node", "/app/host/main.mjs"]
