#!/bin/sh
# Validate the nginx site configurations, here, before they go near the server.
#
# This project has now shipped six nginx configurations that failed `nginx -t`
# on the server: a duplicate gzip, a location at the wrong level, an unknown
# http2 directive, protocol options redefined, a missing certificate, and
# limit_except outside a location. Every one of those was a round trip through
# a person, and every one of them was findable in a second here.
#
# Runs a throwaway nginx container over the real files, with self-signed
# certificates generated at the paths the configs expect — so nothing has to be
# edited to be tested, and what is tested is what gets installed.
#
# Usage: ./deploy/nginx/check.sh

set -eu
cd "$(dirname "$0")/../.."

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/certs" "$WORK/sites"
cp deploy/nginx/*.conf "$WORK/sites/" 2>/dev/null || true

# A certificate at every path the configs name.
#
# nginx -t loads certificates, so a missing one fails the check for a reason
# that has nothing to do with the configuration — that was nginx mistake number
# five. The paths differ by deployment: the containerised site uses
# /etc/nginx/certs, the host one uses /etc/letsencrypt/live. Generating at
# whatever each file actually says means no config has to be edited to be
# tested, and what is tested is what gets installed.
mkdir -p "$WORK/fs"
MOUNTS=""
CERTS=$(grep -ho '^[[:space:]]*ssl_certificate\(_key\)\?  *[^;]*' "$WORK/sites"/*.conf "$WORK/snippets"/*.conf 2>/dev/null |
        sed 's/.*ssl_certificate\(_key\)\?  *//' | sort -u)
for cert in $CERTS; do
  mkdir -p "$WORK/fs$(dirname "$cert")"
done
for cert in $CERTS; do
  case "$cert" in
    *fullchain.pem|*cert.pem)
      key=$(dirname "$cert")/privkey.pem
      openssl req -x509 -newkey rsa:2048 -nodes -days 1 \
        -keyout "$WORK/fs$key" -out "$WORK/fs$cert" \
        -subj "/CN=$(basename "$(dirname "$cert")")" >/dev/null 2>&1
      ;;
  esac
done
# Mount the directory that holds the per-name directories, never /etc/nginx
# itself — that would replace the image's own configuration.
for dir in $(for cert in $CERTS; do dirname "$(dirname "$cert")"; done | sort -u); do
  [ -d "$WORK/fs$dir" ] && MOUNTS="$MOUNTS -v $WORK/fs$dir:$dir:ro"
done

# Sites and snippets are not the same kind of file and cannot be tested the
# same way. A site declares its own `server { }`; a snippet is a fragment that
# has to be included *from inside* one — which is exactly the confusion that
# produced "location directive is not allowed here" on the server once.
mkdir -p "$WORK/snippets"
for file in "$WORK/sites"/*.conf; do
  grep -qE '^[[:space:]]*server[[:space:]]*\{' "$file" || mv "$file" "$WORK/snippets/"
done

SITES=$(ls "$WORK/sites" 2>/dev/null | tr '\n' ' ')
SNIPPETS=$(ls "$WORK/snippets" 2>/dev/null | tr '\n' ' ')

# Upstream names resolve inside the compose network and nowhere else, and nginx
# resolves them at startup — so `app:4100` fails the check for a reason that has
# nothing to do with the configuration being wrong. Point every named upstream
# at loopback for the duration of the test.
#
# Both the places a hostname can appear: a proxy_pass, and a `server` line
# inside an upstream block — which is where `app:4100` was hiding when the first
# version of this check missed it.
HOSTS=""
for host in $( { grep -ho 'proxy_pass  *https\?://[A-Za-z][A-Za-z0-9_.-]*' "$WORK/sites"/*.conf "$WORK/snippets"/*.conf 2>/dev/null | sed 's|.*://||'
                 grep -ho '^[[:space:]]*server  *[A-Za-z][A-Za-z0-9_.-]*:[0-9]' "$WORK/sites"/*.conf "$WORK/snippets"/*.conf 2>/dev/null | sed 's|.*server  *||; s|:.*||'
               } | sort -u); do
  case "$host" in
    127.0.0.1|localhost) continue ;;
  esac
  HOSTS="$HOSTS --add-host $host:127.0.0.1"
done

echo "snippets: ${SNIPPETS:-none}   (checked inside a server block, as they are used)"
echo

# Each site is checked on its own.
#
# Some of these are alternatives rather than companions —
# plugin-universe.conf is for nginx in a container, plugin-universe.host.conf
# for nginx on the host, and they are never installed together. Loading them as
# a set produces a "duplicate upstream" that says nothing about either file.
# What is being checked here is that each file is valid nginx; whether two are
# installed at once is a deployment decision.
STATUS=0
for site in "$WORK/sites"/*.conf; do
  [ -e "$site" ] || continue
  name=$(basename "$site")
  {
    echo 'events {}'
    echo 'http {'
    echo '  include       /etc/nginx/mime.types;'
    echo '  default_type  application/octet-stream;'
    echo '  access_log    /dev/null;'
    echo '  server {'
    echo '    listen 8080 default_server;'
    echo '    server_name _;'
    [ -n "$SNIPPETS" ] && echo '    include /etc/nginx/snippets/*.conf;'
    echo '  }'
    echo "  include /etc/nginx/sites/$name;"
    echo '}'
  } > "$WORK/nginx.conf"

  # shellcheck disable=SC2086
  # shellcheck disable=SC2086
  if output=$(docker run --rm $HOSTS $MOUNTS \
        -v "$WORK/nginx.conf:/etc/nginx/nginx.conf:ro" \
        -v "$WORK/sites:/etc/nginx/sites:ro" \
        -v "$WORK/snippets:/etc/nginx/snippets:ro" \
        nginx:alpine nginx -t 2>&1); then
    warnings=$(echo "$output" | grep -c '\[warn\]' || true)
    echo "  ok    $name$([ "$warnings" -gt 0 ] && echo "   ($((warnings / 2)) warning(s))")"
    # Shown, not just counted. A warning nobody can read is a warning nobody
    # acts on, and the deprecation notices hide real ones — a duplicate
    # directive or a conflicting server name is a warning, not an error.
    if [ "$warnings" -gt 0 ]; then
      echo "$output" | grep '\[warn\]' |
        sed -e 's/^.*\[warn\] //' -e 's/^[0-9]*#[0-9]*: //' | sort -u | sed 's/^/          /'
    fi
  else
    echo "  FAIL  $name"
    echo "$output" | grep '\[emerg\]' | sed 's/^/        /' | head -3
    STATUS=1
  fi
done

exit $STATUS
