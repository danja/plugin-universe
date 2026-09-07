# The profiler image.
#
# The only image in this project that runs code the project did not write, and
# it is built to be a poor place to run anything else: no shell utilities beyond
# what the tools need, no network tooling, no package manager left behind, and
# an unprivileged user. Everything that confines it at run time is in
# src/profiler/Sandbox.js; this is the part that has to be small.
FROM debian:bookworm-slim

# lilv-utils gives lv2info and lv2ls: they read a bundle's metadata through the
# same library a host would use, so what they report is what a host would see,
# rather than what the bundle's Turtle claims. That difference is the entire
# point of measuring rather than trusting a profile.
RUN apt-get update && apt-get install -y --no-install-recommends \
      lilv-utils \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1001 --create-home --shell /bin/false profiler

# LV2_PATH points only at the read-only mount, so a scan cannot pick up
# anything else that happens to be installed.
ENV LV2_PATH=/plugin
USER 1001
WORKDIR /tmp
ENTRYPOINT []
