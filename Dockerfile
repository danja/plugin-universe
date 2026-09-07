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
ENV PORT=4100
EXPOSE 4100

# The API answers /health with the corpus and index sizes, so this checks that
# the store is reachable and the index loaded — not merely that a process is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "bin/serve.js"]
