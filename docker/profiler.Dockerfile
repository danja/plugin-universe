# The profiler image.
#
# The only image in this project that runs code the project did not write, and
# it is built to be a poor place to run anything else: no shell utilities beyond
# what the tools need, no network tooling, no package manager left behind, and
# an unprivileged user. Everything that confines it at run time is in
# src/profiler/Sandbox.js; this is the part that has to be small.
#
# Two tools live here, and they answer different questions. lilv reads what an
# LV2 bundle declares; pluginval instantiates a plugin and drives audio through
# it. The first is a scan, the second is a host — which is why pluginval is the
# one that reaches VST3, and why it is also the one most likely to be crashed by
# what it is measuring.
#
# **The base image is a measurement instrument, not a detail.** A plugin is a
# shared object, and this image's glibc is the floor under every plugin it can
# load. On bookworm (2.36) the 46 built downspout VST3s — compiled against 2.38
# — did not load at all, and pluginval reported "Num plugins found: 0", which is
# what it also says about a genuinely broken plugin. That reading would have
# been published as a fact about the plugins rather than about the container.
# Trixie is here for its 2.41. Moving this line downwards is a change to what
# every measurement means; PluginvalScanner checks the loader separately so
# that the next such mismatch is reported rather than misattributed.

# ── pluginval, built from source ────────────────────────────────────────────
# Tracktion publish binaries, but only for tagged releases, and the tags predate
# the CMake/CPM build this checkout uses. Building from a pinned commit is
# reproducible in a way "download the latest release" is not, and the profiler's
# whole claim is that its readings can be reproduced.
FROM debian:trixie-slim AS pluginval-build

# An exact commit, not a branch. A profiler whose tool silently changed version
# between two runs has made those two runs incomparable, and pu:tool records a
# version precisely so that comparison is possible.
ARG PLUGINVAL_REF=4c5adc2c1a9910251667152166139a0c37b953e6

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git ca-certificates pkg-config \
      libasound2-dev libfreetype6-dev libfontconfig1-dev \
      libx11-dev libxext-dev libxcomposite-dev \
      libxcursor-dev libxinerama-dev libxrandr-dev libgl1-mesa-dev \
      mesa-common-dev ladspa-sdk \
    && rm -rf /var/lib/apt/lists/*
# fontconfig is here because of how JUCE asks for freetype: one pkg-config call
# for "freetype2;fontconfig", which yields nothing at all when either half is
# missing. The build then fails on `ft2build.h: No such file or directory`,
# which names the package that *is* installed and not the one that is not.
#
# libcurl and webkit are absent deliberately: pluginval's CMakeLists sets
# JUCE_USE_CURL=0 and JUCE_WEB_BROWSER=0, so a profiler that could open a URL
# would be one built with capabilities it has no use for.

WORKDIR /build
RUN git init -q . \
 && git remote add origin https://github.com/Tracktion/pluginval.git \
 && git fetch -q --depth 1 origin "${PLUGINVAL_REF}" \
 && git checkout -q FETCH_HEAD

# JUCE, fetched here rather than left to CPM. CPM clones the whole history for
# a tag that is one commit — a quarter of an hour and about a gigabyte — and
# does it inside the configure step, so every failed build downloads it again.
# Shallow, in a layer of its own, and handed to CPM as a local source.
ARG JUCE_TAG=8.0.13
RUN git clone -q --depth 1 --branch "${JUCE_TAG}" \
      https://github.com/juce-framework/JUCE.git /juce

# PLUGINVAL_VST3_VALIDATOR=OFF: with it on, pluginval carries Steinberg's
# vstvalidator embedded as a byte array and extracts it to a temporary file to
# run. The sandbox mounts /tmp noexec, so that extraction would fail at the
# point of execution — and relaxing noexec for one tool would relax it for
# everything else in here too. VST3 *hosting* is unaffected: JUCE 8 carries its
# own copy of the SDK under juce_audio_processors_headless, which is what
# pluginval's own VST3 tests run through.
#
# Configure and build as two layers, so a compile error does not cost a
# re-fetch of everything CPM pulls.
RUN cmake -B Builds \
      -DCMAKE_BUILD_TYPE=Release \
      -DPLUGINVAL_VST3_VALIDATOR=OFF \
      -DCPM_juce_SOURCE=/juce \
      .
# Four jobs, not $(nproc). JUCE compiles its modules as unity blobs and each one
# wants a gigabyte or more; eight at once on a 16 GB machine swapped hard enough
# that a single translation unit took twenty minutes. The build is not the thing
# to optimise here — finishing it is.
ARG BUILD_JOBS=4
RUN cmake --build Builds --config Release --parallel "${BUILD_JOBS}" \
 && install -m 0755 Builds/pluginval_artefacts/Release/pluginval /usr/local/bin/pluginval

# ── the runtime image ───────────────────────────────────────────────────────
FROM debian:trixie-slim

# lilv-utils gives lv2info and lv2ls: they read a bundle's metadata through the
# same library a host would use, so what they report is what a host would see,
# rather than what the bundle's Turtle claims. That difference is the entire
# point of measuring rather than trusting a profile.
#
# The rest is what a plugin needs to be loadable. Note that this is a longer
# list than what *pluginval* links against: the plugins are the third-party
# code, and a JUCE plugin pulls in X11, freetype and dbus whether or not its
# editor is ever opened. A library missing here is not a neutral omission — it
# makes a working plugin unloadable, and an unloadable plugin looks exactly like
# a broken one from the outside.
#
# There is no Xvfb. pluginval validates headless without an X connection, which
# was worth checking rather than assuming: the image had an Xvfb in it on the
# assumption that a JUCE GUI application must need one, and `xvfb-run` then hung
# rather than failing.
RUN apt-get update && apt-get install -y --no-install-recommends \
      lilv-utils \
      libasound2t64 libfreetype6 libfontconfig1 libdbus-1-3 \
      libx11-6 libxext6 libxcomposite1 libxcursor1 libxinerama1 libxrandr2 \
      libgl1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --uid 1001 --create-home --shell /bin/false profiler

COPY --from=pluginval-build /usr/local/bin/pluginval /usr/local/bin/pluginval

# Which commit built the binary in this image. Nothing reads it at run time —
# PluginvalScanner asks the binary itself what version it is, because a label
# records what was intended and `--version` records what is there.
ARG PLUGINVAL_REF
LABEL org.opencontainers.image.revision.pluginval="${PLUGINVAL_REF}"

# Fail the build rather than the run if a shared library is missing: a profiler
# that cannot start its own tool would otherwise report every plugin as broken.
RUN ldd /usr/local/bin/pluginval | grep -q "not found" && exit 1 || true

# LV2_PATH points only at the read-only mount, so a scan cannot pick up
# anything else that happens to be installed. HOME and TMPDIR point at the
# tmpfs because the sandbox mounts the filesystem read-only and JUCE wants
# somewhere to write.
ENV LV2_PATH=/plugin \
    HOME=/tmp \
    TMPDIR=/tmp
USER 1001
WORKDIR /tmp
ENTRYPOINT []
