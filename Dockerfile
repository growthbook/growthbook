# syntax=docker/dockerfile:1
#
# ============================================================================
# GrowthBook on Docker Hardened Images (DHI)
# ============================================================================
# The runtime base is a continuously-rebuilt, near-zero-CVE hardened image
# instead of node:24-slim, whose OS libs only move when we hand-bump them. This
# eliminates the class of "Debian published the patch but our base never absorbs
# it" findings (e.g. gnutls28 / libgcrypt20) outright — the affected packages
# aren't shipped at all rather than chased rebuild after rebuild.
#
# The runtime is distroless: no shell, no package manager, non-root (uid 1000).
# The final image is assembled entirely by COPY from earlier build stages, since
# DHI images are single-purpose and GrowthBook's runtime is polyglot (Node 24
# supervising the app, plus a Python 3.11 gbstats venv the back-end spawns).
#
# Base generation is pinned to debian-12 (bookworm) on purpose: it matches the
# glibc of today's node:24-slim, so the gbstats venv and the kerberos native
# addon stay ABI-compatible. Do NOT casually move to debian-13.
# ============================================================================

ARG PYTHON_MAJOR=3.11
ARG NODE_MAJOR=24

# ----------------------------------------------------------------------------
# Stage 1: build the gbstats Python venv against the HARDENED interpreter.
#
# Critical: the venv records the interpreter path (pyvenv.cfg + bin symlinks).
# It must be built against the same /opt/python that ships in the final image,
# so we build it inside the DHI python *dev* variant (has apt/bash/pip/root)
# rather than the old python:3.11-slim (whose interpreter lives at /usr/local
# and would not exist in the final image).
# ----------------------------------------------------------------------------
FROM dhi.io/python:${PYTHON_MAJOR}-debian12-dev AS pybuild
ARG UPGRADE_PIP="true"
WORKDIR /usr/local/src/app
COPY ./packages/stats .

# DHI python lives at /opt/python (PATH/LD_LIBRARY_PATH already set by the base).
# Create the venv at /opt/venv exactly as today; it will reference /opt/python.
ENV VIRTUAL_ENV=/opt/venv
RUN python3 -m venv $VIRTUAL_ENV
ENV PATH="$VIRTUAL_ENV/bin:${PATH}"

RUN \
  if [ "$UPGRADE_PIP" = "true" ]; then pip install --upgrade pip; fi \
  && pip install --no-cache-dir poetry==1.8.5 \
  && poetry install --no-root --without dev --no-interaction --no-ansi \
  && poetry build \
  && poetry export -f requirements.txt --output requirements.txt \
  && pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir dist/*.whl ddtrace==4.3.2 "cryptography>=46.0.6,<47"
# cryptography pinned to override a transitive dep and fix a vulnerability.
# This stage has no compiler (the dev variant ships only binutils), which works
# because every gbstats dep resolves to a manylinux wheel today. If a future
# gbstats dep is sdist-only, add a compiler to this stage or pre-build the wheel.

# Strip poetry + build-time-only footprint so non-runtime deps (and their CVEs)
# don't ride along in the venv we copy into the final image. (Same list as the
# stock Dockerfile — see its comment for why each is safe to remove.)
RUN pip uninstall -y poetry poetry-core poetry-plugin-export keyring jaraco.classes setuptools wheel dulwich

# Stage the SYSTEM shared-lib closure the venv + interpreter need at runtime.
# /opt/python and /opt/venv are self-contained for Python *code*, but Python's
# C extensions and the wheels (numpy/pandas/scipy/ddtrace) dynamically link OS
# libs — libz, libbz2, liblzma, libffi, libsqlite3, libgfortran/libquadmath, etc.
# The DHI python image ships these as OS packages; our final base is the DHI
# *node* runtime, which doesn't. Copying /opt/python alone misses them (numpy's
# `libz.so.1: cannot open shared object file` is the first symptom). ldd every
# .so once and collect the union into /opt/pydeps for the runtime to mount on
# LD_LIBRARY_PATH. (ld-linux has no "=>" so it's skipped; cp -n avoids clobber.)
RUN mkdir -p /opt/pydeps && \
  find /opt/venv /opt/python -name '*.so*' -type f -print0 \
    | xargs -0 -r -n1 ldd 2>/dev/null \
    | awk '/=> \//{print $3}' | sort -u \
    | xargs -r -I{} cp -Ln {} /opt/pydeps/ 2>/dev/null || true; \
  echo "staged (sweep):" && ls -1 /opt/pydeps | sort

# The sweep above scans the venv's .so files but misses the interpreter's own
# stdlib extensions (lib-dynload), so Python stdlib system deps — libffi
# (_ctypes), libsqlite3 (_sqlite3), libbz2, liblzma, libreadline, etc. — never
# get staged (numpy pulled libz, which is why that one slipped through). Copy
# them deterministically from the exact packages the DHI python image installs;
# this dev image has dpkg and all of them, so the set is authoritative.
RUN for p in libffi8 libbz2-1.0 liblzma5 libsqlite3-0 libncursesw6 libreadline8 \
             libtinfo6 libuuid1 libcrypt1 libdb5.3 zlib1g; do \
      dpkg -L "$p" 2>/dev/null | grep '\.so' \
        | xargs -r -I{} cp -Ln {} /opt/pydeps/ 2>/dev/null || true; \
    done; \
  echo "staged (sweep + stdlib):" && ls -1 /opt/pydeps | sort

# ----------------------------------------------------------------------------
# Stage 2: build the Node app. Unchanged from the stock Dockerfile and still on
# node:24-slim — this stage is build-only, never shipped, so its CVEs don't
# reach production. It has apt for build-essential / libkrb5-dev / node-gyp,
# which the hardened runtime deliberately lacks. Keeping it as-is minimizes the
# diff and the risk surface of the spike.
# ----------------------------------------------------------------------------
FROM node:${NODE_MAJOR}-slim AS nodebuild
WORKDIR /usr/local/src/app
ARG NODE_OPTIONS="--max-old-space-size=8192"
ENV NODE_OPTIONS="${NODE_OPTIONS}"
RUN apt-get update && \
  apt-get install -y --no-install-recommends build-essential python3 ca-certificates libkrb5-dev && \
  npm install -g pnpm@10.33.4 node-gyp && \
  apt-get clean && \
  rm -rf /var/lib/apt/lists/*
COPY patches ./patches
COPY pnpm-lock.yaml ./pnpm-lock.yaml
RUN pnpm fetch
COPY .npmrc ./.npmrc
COPY package.json ./package.json
COPY pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY packages/front-end/package.json ./packages/front-end/package.json
COPY packages/back-end/package.json ./packages/back-end/package.json
COPY packages/sdk-js/package.json ./packages/sdk-js/package.json
COPY packages/sdk-react/package.json ./packages/sdk-react/package.json
COPY packages/shared/package.json ./packages/shared/package.json
RUN pnpm install --frozen-lockfile --offline
RUN pnpm postinstall
COPY packages ./packages
RUN \
  pnpm build \
  && test -f packages/back-end/dist/server.js || (echo "ERROR: packages/back-end/dist/server.js is missing after build!" && exit 1) \
  && rm -rf node_modules \
  && rm -rf packages/back-end/node_modules \
  && rm -rf packages/front-end/node_modules \
  && rm -rf packages/front-end/.next/cache \
  && rm -rf packages/shared/node_modules \
  && rm -rf packages/sdk-js/node_modules \
  && rm -rf packages/sdk-react/node_modules \
  && pnpm install --frozen-lockfile --prod --no-optional \
  && pnpm store prune \
  && find node_modules -type f -name "*.md" -delete \
  && find node_modules -type f -name "*.ts" ! -name "*.d.ts" -delete \
  && find node_modules -type f -name "*.map" -delete \
  && find node_modules -type f -name "CHANGELOG*" -delete \
  && find node_modules -type f -name "LICENSE*" -delete \
  && find node_modules -type f -name "README*" -delete \
  && find node_modules -type d -name benchmarks -prune -exec rm -rf {} + \
  && rm -f packages/stats/poetry.lock
RUN pnpm postinstall

# Force the kerberos native addon to compile from source so a literal
# build/Release/kerberos.node exists. By default kerberos ships a prebuilt
# binary that node-gyp-build selects via runtime glibc/musl detection — and that
# detection fails in the minimal distroless runtime (no ldd, sparse /etc), so it
# falls through to a non-existent build/Debug and crashes at require time. A real
# build/Release file is resolved by path, no detection needed. The toolchain
# (build-essential / node-gyp / python3 / libkrb5-dev) is already present in this
# stage. This is why the stock node:24-slim image works and the hardened one didn't.
RUN pnpm rebuild kerberos && \
    test -f node_modules/.pnpm/kerberos@2.2.2/node_modules/kerberos/build/Release/kerberos.node \
      || (echo "ERROR: kerberos.node was not produced by the source build" && exit 1)

# ----------------------------------------------------------------------------
# Stage 3: collect the runtime Kerberos shared libs.
#
# back-end depends on kerberos@2.x (MongoDB GSSAPI auth). The addon `dlopen`s
# libgssapi_krb5.so.2 BY NAME at runtime — it is NOT an ELF NEEDED of
# kerberos.node, so `ldd kerberos.node` won't reveal it. That lib lives in the
# `libgssapi-krb5-2` package, which `libkrb5-3` does NOT depend on (the original
# "Opening library libgssapi_krb5.so.2 failed" cause). We install it, then copy
# the lib PLUS its full ldd closure (libkrb5, libk5crypto, libcom_err,
# libkrb5support, libkeyutils, and libcrypto/libssl — which the DHI node base
# excludes) into /krb5deps. debian:12-slim matches the runtime's debian-12 ABI.
# The dynamic linker (ld-linux line, no "=>") is intentionally excluded.
# ----------------------------------------------------------------------------
FROM debian:12-slim AS krb5libs
RUN apt-get update && \
  apt-get install -y --no-install-recommends libgssapi-krb5-2 && \
  rm -rf /var/lib/apt/lists/*
RUN mkdir -p /krb5deps && \
  cp -L /usr/lib/x86_64-linux-gnu/libgssapi_krb5.so.2 /krb5deps/ && \
  ldd /usr/lib/x86_64-linux-gnu/libgssapi_krb5.so.2 \
    | awk '/=> \//{print $3}' | sort -u | xargs -I{} cp -L {} /krb5deps/ && \
  echo "staged krb5 closure:" && ls -1 /krb5deps
# /usr/bin/env (coreutils) is also pulled from here — see stage 4.

# ----------------------------------------------------------------------------
# Stage 4: the hardened runtime image.
#
# FROM the DHI node:24 runtime variant: distroless, no shell, no apt, no npm/
# pnpm, runs as uid 1000 (`node`), node at /usr/local/bin/node. We override its
# default /app workdir to /usr/local/src/app to match the stock image AND the
# Helm chart, which hardcodes paths like the uploads mount
# (/usr/local/src/app/packages/back-end/uploads) — keeping divergence minimal.
# Because there is NO shell, this stage can run NO `RUN` steps — every artifact
# must arrive via COPY and every path decision is made with ENV. The stock
# Dockerfile's final-stage `apt-get`, `ln -sf`, `chmod`, and bash verification
# block are all gone by necessity (verification moves to the boot test).
# ----------------------------------------------------------------------------
FROM dhi.io/node:${NODE_MAJOR}-debian12
WORKDIR /usr/local/src/app

# Hardened Python interpreter + the gbstats venv built against it, plus the
# system shared-lib closure they need (libz, libbz2, libffi, libgfortran, … —
# staged in the pybuild stage; absent from the node base). See that stage.
COPY --from=pybuild /opt/python /opt/python
COPY --from=pybuild /opt/venv /opt/venv
COPY --from=pybuild /opt/pydeps /opt/pydeps

# /usr/bin/env — cheap insurance for any `#!/usr/bin/env node` scripts the app
# may exec at runtime (the DHI node runtime ships no coreutils). Nothing on the
# boot path is known to need it; it's kept only to avoid surprising an operator.
COPY --from=krb5libs /usr/bin/env /usr/bin/env

# Kerberos GSSAPI lib + its full dependency closure (see krb5libs stage), placed
# in a dedicated dir that's added to LD_LIBRARY_PATH below.
COPY --from=krb5libs /krb5deps/ /opt/krb5deps/

# PATH: venv first so `python3` resolves to the gbstats interpreter (the
# back-end spawns bare `python3` / `ddtrace-run python3` — see
# packages/back-end/src/services/python.ts). Then the hardened python bin, then
# the node bin. LD_LIBRARY_PATH: /opt/python/lib (hardened interpreter's own
# bundled libs, e.g. libssl), /opt/pydeps (system-lib closure for numpy/pandas/
# etc.), /opt/krb5deps (the GSSAPI closure kerberos dlopens at runtime).
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:/opt/python/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin"
ENV LD_LIBRARY_PATH="/opt/python/lib:/opt/pydeps:/opt/krb5deps:/usr/lib/x86_64-linux-gnu"
# Read-only-rootfs friendly defaults: don't write venv .pyc into the read-only
# /opt/venv, and skip Next's telemetry write. The remaining writable paths
# (/tmp, .next/cache, uploads) are declared as mounts by the deployer (emptyDir
# or PVC in k8s — see the Helm chart values).
ENV PYTHONDONTWRITEBYTECODE=1
ENV NEXT_TELEMETRY_DISABLED=1

# App code from the node build stage.
COPY --from=nodebuild /usr/local/src/app/packages ./packages
COPY --from=nodebuild /usr/local/src/app/node_modules ./node_modules
COPY --from=nodebuild /usr/local/src/app/package.json ./package.json

# ecosystem.config.js is retained for `pm2-runtime` users on the stock image and
# as the source of truth for the supervisor's process list. bin/yarn is omitted:
# it's a bash shim that can't run in a shell-less runtime, and the CMD below
# invokes the supervisor directly.
COPY ecosystem.config.js ./ecosystem.config.js
COPY bin/dhi-supervisor.js ./bin/dhi-supervisor.js
COPY buildinfo* ./buildinfo

# Stray .ts/.tsx removal (the stock image's final-stage RUN) happens in the
# nodebuild stage instead — there is no shell here to run it.

# Build metadata (unchanged).
ARG DD_GIT_COMMIT_SHA=""
ARG DD_GIT_REPOSITORY_URL=https://github.com/growthbook/growthbook.git
ARG DD_VERSION=""
ENV DD_GIT_COMMIT_SHA=$DD_GIT_COMMIT_SHA \
    DD_GIT_REPOSITORY_URL=$DD_GIT_REPOSITORY_URL \
    DD_VERSION=$DD_VERSION

EXPOSE 3000
EXPOSE 3100
# pm2-runtime is gone: it shells out (`/bin/sh -c "getconf CLK_TCK"`) for process
# metrics, which is fatal in a shell-less runtime. Replaced by a small shell-free
# Node supervisor that forks the same two processes and lets the orchestrator
# handle restarts. See bin/dhi-supervisor.js.
CMD ["/usr/local/bin/node", "bin/dhi-supervisor.js"]
