#!/bin/sh
# Deploy the current branch to this machine, and prove it landed.
#
# The supported way to build this image. A bare `docker compose build` leaves
# the commit stamp empty; this fills it, so that /health can say which code is
# running rather than only which data.
#
# It exists because of the two ways a deploy has silently not happened here:
#
#   - `git pull` was forgotten, so a correct build produced the old code
#   - `docker compose restart` was used, which reuses the existing image
#
# Both left a site that looked entirely healthy. This does the whole sequence
# and then checks, from outside, that the running container reports the commit
# it was just given. Data is not touched: an ingest is a separate decision.
#
# Usage:  ./bin/deploy.sh            deploy HEAD after pulling
#         ./bin/deploy.sh --no-pull  deploy the working tree as it stands

set -eu

cd "$(dirname "$0")/.."

if [ "${1:-}" != "--no-pull" ]; then
  # Local modifications stop a pull with a message about "local changes being
  # overwritten", which is accurate and unhelpful at the moment you read it.
  # Say which files, and say which of them are safe to throw away.
  DIRTY=$(git status --porcelain -- . | awk '$1 ~ /^(M|MM| M|A)/ { print $2 }')
  if [ -n "$DIRTY" ]; then
    echo "!!  These files differ from the committed version and would block the pull:"
    for file in $DIRTY; do echo "!!    $file"; done
    echo "!!"
    case "$DIRTY" in
      *package-lock.json*)
        echo "!!  package-lock.json is generated. Running npm on the server rewrites it,"
        echo "!!  and the image builds from the committed one with 'npm ci', so the local"
        echo "!!  copy is not wanted:"
        echo "!!    git restore package-lock.json"
        echo "!!"
        ;;
    esac
    echo "!!  Discard a file with 'git restore <file>', or commit it, then run this again."
    exit 1
  fi

  echo "==> git pull --ff-only"
  # --ff-only, so a diverged branch stops here rather than being merged by a
  # deploy script at whatever hour this is being run.
  git pull --ff-only
fi

BUILD_COMMIT=$(git rev-parse HEAD)
BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ)
export BUILD_COMMIT BUILD_TIME

# Does anything that actually reaches the image differ from the commit?
#
# Not "is the working tree dirty". A server accumulates untracked artefacts —
# harvest caches, dumps, the candidate file a sweep wrote — and every one of
# them is excluded by .dockerignore, so none of them is built into anything.
# Warning about those said the stamp was misleading when it was exactly right,
# which teaches people to ignore the warning.
IMAGE_DIRTY=$(git status --porcelain -uall | while read -r _ path; do
  excluded=no
  while read -r rule; do
    case "$rule" in ''|'#'*|'!'*) continue ;; esac
    case "$path" in "${rule%/}"|"${rule%/}"/*) excluded=yes ;; esac
  done < .dockerignore
  [ "$excluded" = no ] && echo "$path"
done)

if [ -n "$IMAGE_DIRTY" ]; then
  echo "!!  These differ from the commit and DO reach the image:"
  echo "$IMAGE_DIRTY" | sed 's/^/!!    /'
  echo "!!  /health will report ${BUILD_COMMIT}, which is not what is running."
  echo "!!  Commit first, or accept a misleading stamp."
fi

echo "==> building ${BUILD_COMMIT}"
docker compose build app
echo "==> starting"
docker compose up -d app

echo "==> waiting for /health"
PORT="${APP_PORT:-4100}"
i=0
while [ "$i" -lt 60 ]; do
  RUNNING=$(curl -sf "http://127.0.0.1:${PORT}/health" 2>/dev/null \
            | tr -d ' \n' | sed -n 's/.*"commit":"\([^"]*\)".*/\1/p') || true
  if [ -n "${RUNNING:-}" ]; then break; fi
  i=$((i + 1))
  sleep 1
done

if [ -z "${RUNNING:-}" ]; then
  echo "!!  The container is not reporting a build commit."
  echo "!!  Either it has not come up, or it was built without bin/deploy.sh."
  docker compose logs --tail=20 app
  exit 1
fi

if [ "$RUNNING" != "$BUILD_COMMIT" ]; then
  echo "!!  Running ${RUNNING}, expected ${BUILD_COMMIT}."
  echo "!!  The container was not replaced. Try:"
  echo "!!    docker compose up -d --force-recreate app"
  exit 1
fi

echo "==> ${RUNNING} is live"
echo "    Code only. If the data changed too, run the ingest and restart:"
echo "      docker compose run --rm app node bin/ingest.js --only-new"
echo "      docker compose restart app"
