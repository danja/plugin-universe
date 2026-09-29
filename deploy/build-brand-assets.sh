#!/usr/bin/env bash
# Regenerates every brand image the site serves from the two sources in
# docs/images/: logo.jpeg (mark + wordmark on #020925) and nothing else.
#
# The rough favicon-rough.jpeg was 375px with a stray fragment at its left edge
# and no alpha channel, so the icons are cut from the logo's own mark instead —
# same drawing, three times the pixels, and rounded here with a real mask.
#
# Outputs, at the repository root because STATIC_FILES serves them by name:
#   favicon.ico          16/32/48, the file browsers ask for at /favicon.ico
#   favicon.png          48px, what <link rel="icon"> points at
#   apple-touch-icon.png 180px, opaque and square (iOS rounds it itself)
#   icon-192.png         manifest icon, also the mark in the page header
#   icon-512.png         manifest icon
#   og-image.png         1200x630 social card (Open Graph and X/Twitter)
#
# Needs ImageMagick 6+ (`convert`) and DejaVu Sans. Run from the repository root.
set -euo pipefail

SRC=docs/images/logo.jpeg
NAVY='#020925'
[ -f "$SRC" ] || { echo "run from the repository root: $SRC not found" >&2; exit 1; }
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# The mark: orbit, sphere and unit, without the wordmark below it. Padded to a
# square on the logo's own background so the orbit keeps a margin at 16px.
convert "$SRC" -crop 720x540+395+65 +repage \
  -background "$NAVY" -gravity center -extent 820x820 "$WORK/mark-square.png"

# Rounded tile for browser tabs (transparent corners).
convert "$WORK/mark-square.png" -resize 512x512 \
  \( -size 512x512 xc:none -fill white -draw 'roundrectangle 0,0 511,511 112,112' \) \
  -alpha set -compose DstIn -composite "$WORK/tile-512.png"

convert "$WORK/tile-512.png" -resize 512x512 icon-512.png
convert "$WORK/tile-512.png" -resize 192x192 icon-192.png
convert "$WORK/tile-512.png" -resize 48x48 favicon.png
convert "$WORK/mark-square.png" -resize 180x180 -alpha off apple-touch-icon.png
for s in 16 32 48; do convert "$WORK/tile-512.png" -resize ${s}x${s} "$WORK/i$s.png"; done
convert "$WORK/i16.png" "$WORK/i32.png" "$WORK/i48.png" favicon.ico

# The social card. Mark left, wordmark right, both cut from the logo. The
# important content stays inside the middle 600px of height because X crops
# `summary_large_image` to 2:1 and a client may crop tighter than that.
convert "$SRC" -crop 720x540+395+65 +repage -resize 540x "$WORK/card-mark.png"
convert "$SRC" -crop 860x330+340+595 +repage -resize 520x "$WORK/card-word.png"
convert -size 1200x630 "xc:$NAVY" \
  "$WORK/card-mark.png" -gravity West -geometry +50-10 -composite \
  "$WORK/card-word.png" -gravity NorthWest -geometry +620+130 -composite \
  -font DejaVu-Sans -pointsize 25 -fill '#93a2ac' -gravity NorthWest \
  -annotate +620+362 "An open, machine-readable\ndatabase of DAW plugins." \
  -fill '#00adfe' -pointsize 24 -annotate +620+450 'Search by what a plugin does.' \
  -fill '#93a2ac' -pointsize 20 -gravity SouthWest \
  -annotate +50+38 'plugin-universe.com   ·   facts released under CC0' \
  -depth 8 -strip og-image.png

identify favicon.ico favicon.png apple-touch-icon.png icon-192.png icon-512.png og-image.png
