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

# The runtime uid is fixed and documented because a bind-mounted directory the
# container must write — data/curation — has to be owned by it on the host.
# Override at build time to match a host user: --build-arg APP_UID=$(id -u).
ARG APP_UID=1001
ARG APP_GID=1001

RUN apt-get update && apt-get install -y --no-install-recommends \
      tini libopenblas0 \
    && rm -rf /var/lib/apt/lists/* \
    # node:22-slim already ships uid/gid 1000 as "node", so creating ours
    # unconditionally fails for exactly the value a host user most often has.
    # Reuse the ids when they are taken, create them when they are free.
    && (getent group ${APP_GID} > /dev/null || groupadd --gid ${APP_GID} plugin-universe) \
    && (getent passwd ${APP_UID} > /dev/null \
        || useradd --uid ${APP_UID} --gid ${APP_GID} --create-home --shell /bin/false plugin-universe)

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --chown=${APP_UID}:${APP_GID} . .

# What this image is, so a running container can say which code it holds.
#
# Deliberately no default. An unset argument becomes an empty variable and
# /health reports the build as unknown, which is the truth; a default of
# "unknown" baked into the image would be the same claim made less honestly,
# and a default of "latest" would be a lie. bin/deploy.sh fills both in.
#
# Last, so that changing them does not invalidate the layers above.
ARG BUILD_COMMIT
ARG BUILD_TIME
ENV BUILD_COMMIT=${BUILD_COMMIT}
ENV BUILD_TIME=${BUILD_TIME}

# The vector index is state, not build output.
RUN mkdir -p /app/data && chown ${APP_UID}:${APP_GID} /app/data
VOLUME ["/app/data"]

# Numeric, because the account may be a reused one with a different name.
USER ${APP_UID}:${APP_GID}
# Modest by default and overridden from docker-compose.yml. The working set is
# the document map and a few megabytes of vector index, not gigabytes; the old
# 2048 was inherited from a larger machine rather than measured.
ENV NODE_OPTIONS=--max-old-space-size=512
ENV PORT=4100
EXPOSE 4100

# The API answers /health with the corpus and index sizes, so this checks that
# the store is reachable and the index loaded — not merely that a process is up.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||4100)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "bin/serve.js"]
