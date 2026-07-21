# syntax=docker/dockerfile:1
#
# ============================================================================
# GrowthBook on Docker Hardened Images (DHI)
# ============================================================================
# Distroless, continuously-patched hardened runtime base (no shell, no package
# manager, non-root uid 1000) instead of node:24-slim. DHI images are
# single-purpose and our runtime is polyglot (Node 24 supervising the app + a
# Python 3.11 gbstats venv), so the final image is assembled by COPY from the
# build stages below.
#
# Pinned to debian-12 (bookworm) to match the glibc of node:24-slim, keeping the
# gbstats venv and the kerberos native addon ABI-compatible. Do NOT move to
# debian-13 without re-validating both.
# ============================================================================

ARG PYTHON_MAJOR=3.11
ARG NODE_MAJOR=24

# ----------------------------------------------------------------------------
# Stage 1: build the gbstats venv against the DHI python interpreter.
# The venv hardcodes its interpreter path (pyvenv.cfg + bin symlinks), so it must
# be built against the same /opt/python that ships in the final image — hence the
# python -dev variant (apt/pip/root) rather than python:3.11-slim.
# ----------------------------------------------------------------------------
FROM dhi.io/python:${PYTHON_MAJOR}-debian12-dev AS pybuild
ARG UPGRADE_PIP="true"
WORKDIR /usr/local/src/app
COPY ./packages/stats .

# DHI python lives at /opt/python; create the venv at /opt/venv referencing it.
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
  && pip install --no-cache-dir dist/*.whl ddtrace==4.3.2
# No compiler in this stage (dev variant has only binutils) — fine while every
# gbstats dep is a manylinux wheel; add one if a dep ever ships sdist-only.

# Remove poetry's build-only footprint (poetry + its keyring/cryptography backend, setuptools,
# wheel, etc.) from the runtime venv. None are gbstats runtime deps, so dropping them shrinks the
# image and its vulnerability surface. The list lives in check_stripped_deps.STRIPPED so it stays
# in sync with the guard below.
RUN pip uninstall -y $(python -c "from check_stripped_deps import STRIPPED; print(*STRIPPED)")

# Verify the strip held: gbstats still imports with only its runtime deps, and nothing pulled a
# removed package back in. Fails the build otherwise.
RUN python check_stripped_deps.py

# Assert the runtime python entrypoints exist before this venv is copied into the
# shell-less final image (where such a check can't run). Replaces the deleted
# final-stage `command -v` guard for the artifacts produced in this stage.
RUN test -x /opt/venv/bin/python3 && test -x /opt/venv/bin/ddtrace-run \
  || (echo "ERROR: python3/ddtrace-run missing from the venv" && exit 1)

# Stage the system shared-lib closure into /opt/pydeps. The venv's C extensions
# and wheels (numpy/pandas/scipy/ddtrace) dynamically link OS libs (libz, libbz2,
# libffi, libgfortran, …) that the DHI python image ships but the DHI *node*
# runtime (our final base) does not. ldd every .so and collect the union; the
# final stage adds /opt/pydeps to LD_LIBRARY_PATH.
RUN mkdir -p /opt/pydeps && \
  find /opt/venv /opt/python -name '*.so*' -type f -print0 \
    | xargs -0 -r -n1 ldd 2>/dev/null \
    | awk '/=> \//{print $3}' | sort -u \
    | xargs -r -I{} cp -Ln {} /opt/pydeps/ 2>/dev/null || true; \
  echo "staged (sweep):" && ls -1 /opt/pydeps | sort

# The ldd sweep misses the interpreter's stdlib extensions (lib-dynload), so add
# their system deps (libffi for _ctypes, libsqlite3 for _sqlite3, …) explicitly
# via dpkg from the packages the DHI python image installs.
RUN for p in libffi8 libbz2-1.0 liblzma5 libsqlite3-0 libncursesw6 libreadline8 \
             libtinfo6 libuuid1 libcrypt1 libdb5.3 zlib1g; do \
      dpkg -L "$p" 2>/dev/null | grep '\.so' \
        | xargs -r -I{} cp -Ln {} /opt/pydeps/ 2>/dev/null || true; \
    done; \
  echo "staged (sweep + stdlib):" && ls -1 /opt/pydeps | sort

# ----------------------------------------------------------------------------
# Stage 2: build the Node app. Build-only on node:24-slim — never shipped, so its
# CVEs don't reach production, and it keeps the apt toolchain (build-essential /
# libkrb5-dev / node-gyp) that the hardened runtime lacks.
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
COPY packages/stats-ts/package.json ./packages/stats-ts/package.json
# Install dependencies using cached store
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
  && rm -rf packages/stats-ts/node_modules \
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

# Drop front-end TS source + tsconfig so `next start` never tries to enable
# TypeScript at runtime. The stock image did this in a final-stage RUN; the
# distroless final stage has no shell, so it must happen here.
RUN rm -f packages/front-end/tsconfig.json && \
    find packages/front-end -maxdepth 1 -name "*.ts" -delete && \
    find packages/front-end -maxdepth 1 -name "*.tsx" -delete

# Force kerberos to compile from source. Its prebuilt binary is selected by
# node-gyp-build's runtime libc detection, which fails on the distroless runtime
# (no ldd, sparse /etc) and crashes at require time; a from-source
# build/Release/kerberos.node is resolved by path, no detection needed.
RUN pnpm rebuild kerberos && \
    find node_modules/.pnpm -path '*/kerberos/build/Release/kerberos.node' -type f | grep -q . \
      || (echo "ERROR: kerberos.node was not produced by the source build" && exit 1)

# Assert the pm2-runtime entrypoint (the CMD and chart command) exists before this
# node_modules tree is copied into the shell-less final image. Replaces the deleted
# final-stage guard for the node-side artifacts.
RUN test -f node_modules/pm2/bin/pm2-runtime \
  || (echo "ERROR: pm2/bin/pm2-runtime missing from node_modules" && exit 1)

# Repoint the node_modules/.bin/pm2-runtime shim (a #!/bin/sh script that can't exec
# in the shell-less runtime) at pm2's real #!/usr/bin/env node entry. This keeps the
# PREVIOUS launch command — `node_modules/.bin/pm2-runtime …`, still baked into any
# already-published Helm chart and into ECS task defs that pin it — working on this
# image. Without it, an old chart (or a deploy pinning a floating image tag) crashes
# on boot; with it, it boots and serves (degraded only where the old config lacks
# fsGroup/writable mounts). The current chart/CMD invoke pm2 via `node …` directly
# and don't depend on this shim.
RUN ln -sf ../pm2/bin/pm2-runtime node_modules/.bin/pm2-runtime

# Stage an empty uploads dir OUTSIDE the packages tree so the broad `COPY packages`
# in the final stage doesn't create (root-owned) uploads first; the final stage then
# COPYs this in with --chown=1000:1000 (see there).
RUN mkdir -p /uploads

# ----------------------------------------------------------------------------
# Stage 3: collect the runtime Kerberos libs (kerberos@2.x, for MongoDB GSSAPI).
# The addon dlopen()s libgssapi_krb5.so.2 by name at runtime, so it's not an ELF
# NEEDED of kerberos.node and ldd won't reveal it; it ships in libgssapi-krb5-2,
# which libkrb5-3 doesn't pull in. Install it and copy the lib + its full ldd
# closure into /krb5deps. debian:12-slim matches the runtime's debian-12 ABI.
# ----------------------------------------------------------------------------
FROM debian:12-slim AS krb5libs
RUN apt-get update && \
  apt-get install -y --no-install-recommends libgssapi-krb5-2 && \
  rm -rf /var/lib/apt/lists/*
# Resolve the lib path from dpkg rather than hardcoding the multiarch dir, so
# this stage builds on both amd64 (x86_64-linux-gnu) and arm64 (aarch64-linux-gnu).
RUN mkdir -p /krb5deps && \
  LIB="$(dpkg -L libgssapi-krb5-2 | grep '/libgssapi_krb5\.so\.2$')" && \
  cp -L "$LIB" /krb5deps/ && \
  ldd "$LIB" \
    | awk '/=> \//{print $3}' | sort -u | xargs -I{} cp -L {} /krb5deps/ && \
  echo "staged krb5 closure:" && ls -1 /krb5deps
# /usr/bin/env (coreutils) is also pulled from here — see stage 4.

# ----------------------------------------------------------------------------
# Stage 4: the hardened runtime image — DHI node:24, distroless, non-root
# (uid 1000). WORKDIR is /usr/local/src/app to match the Helm chart's hardcoded
# paths (e.g. the uploads mount). With no shell, this stage runs no RUN steps:
# every artifact arrives via COPY and every path decision is made with ENV.
# ----------------------------------------------------------------------------
FROM dhi.io/node:${NODE_MAJOR}-debian12
WORKDIR /usr/local/src/app

# Hardened Python interpreter + gbstats venv + the system shared-lib closure they
# need (staged in pybuild; absent from the node base).
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

# PATH: venv first so bare `python3` resolves to the gbstats interpreter (see
# packages/back-end/src/services/python.ts). LD_LIBRARY_PATH: /opt/python/lib,
# /opt/pydeps, /opt/krb5deps, and the system multiarch dir (libcrypto for
# libk5crypto). Both the amd64 and arm64 multiarch dirs are listed — the loader
# skips the absent one — so the image runs on both arches (deploy builds both).
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:/opt/python/bin:/usr/local/bin:/usr/local/sbin:/usr/bin:/bin"
ENV LD_LIBRARY_PATH="/opt/python/lib:/opt/pydeps:/opt/krb5deps:/usr/lib/x86_64-linux-gnu:/usr/lib/aarch64-linux-gnu"
# Read-only-rootfs friendly defaults: don't write venv .pyc into the read-only
# /opt/venv, skip Next's telemetry write, and point PM2_HOME at /tmp (pm2 writes
# its pid/socket/log files there; the default $HOME/.pm2 isn't writable under a
# read-only rootfs). The remaining writable paths (/tmp, .next/cache, uploads)
# are declared as mounts by the deployer (emptyDir or PVC in k8s — see the chart).
ENV PYTHONDONTWRITEBYTECODE=1
ENV NEXT_TELEMETRY_DISABLED=1
ENV PM2_HOME=/tmp/.pm2

# App code from the node build stage.
COPY --from=nodebuild /usr/local/src/app/packages ./packages
COPY --from=nodebuild /usr/local/src/app/node_modules ./node_modules
COPY --from=nodebuild /usr/local/src/app/package.json ./package.json

# Create the local-uploads dir owned by uid 1000 (sourced from /uploads, staged
# outside packages so this COPY creates it fresh rather than re-owning a root-owned
# dir). A freshly provisioned local volume seeds its ownership from this dir, so it's
# writable by the non-root runtime out of the box. Existing root-owned volumes from
# the previous root image still need a one-time chown to 1000.
COPY --from=nodebuild --chown=1000:1000 /uploads ./packages/back-end/uploads

# pm2 process config (the CMD below runs it). bin/yarn is omitted: it's a bash
# shim that can't run in a shell-less runtime, and the CMD invokes pm2 directly.
COPY ecosystem.config.js ./ecosystem.config.js
COPY buildinfo* ./buildinfo

# Build metadata.
ARG DD_GIT_COMMIT_SHA=""
ARG DD_GIT_REPOSITORY_URL=https://github.com/growthbook/growthbook.git
ARG DD_VERSION=""
ENV DD_GIT_COMMIT_SHA=$DD_GIT_COMMIT_SHA \
    DD_GIT_REPOSITORY_URL=$DD_GIT_REPOSITORY_URL \
    DD_VERSION=$DD_VERSION

EXPOSE 3000
EXPOSE 3100
# Launch pm2-runtime via node directly: the node_modules/.bin/pm2-runtime shim is
# a `#!/bin/sh` script that can't exec in a shell-less runtime, but pm2's real
# entry is plain Node. pm2's only shell-out (pidusage's `getconf` for CPU metrics)
# fails gracefully to a default, so it's not fatal here.
CMD ["/usr/local/bin/node", "node_modules/pm2/bin/pm2-runtime", "start", "ecosystem.config.js"]
