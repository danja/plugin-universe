# Build stage. The native vector dependency needs a toolchain and BLAS; this
# package list is the one thing most likely to cost an hour if it is wrong.
FROM node:22-slim AS builder

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ cmake pkg-config \
      libopenblas-dev libblas-dev liblapack-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-slim AS runtime

RUN apt-get update && apt-get install -y --no-install-recommends \
      tini libopenblas0 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1001 --create-home --shell /bin/false plugin-universe

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=plugin-universe:plugin-universe . .

# The vector index is state, not build output.
RUN mkdir -p /app/data && chown plugin-universe:plugin-universe /app/data
VOLUME ["/app/data"]

USER plugin-universe
ENV NODE_OPTIONS=--max-old-space-size=2048

ENTRYPOINT ["/usr/bin/tini", "--"]
