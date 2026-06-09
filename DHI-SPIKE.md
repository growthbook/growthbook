# Spike: GrowthBook on Docker Hardened Images (DHI)

**Status:** ✅ working build — boots cleanly and a full in-app experiment
results refresh (which exercises the Python/gbstats stats engine) succeeds on
the hardened image. CVE comparison vs stock below. See `Dockerfile.dhi`.
**Branch:** `spike/dhi-base-image`

## Result in one line

Same source, swap `node:24-bookworm-slim` → DHI `node:24-debian12`:
**High CVEs 16 → 6, Medium 11 → 5, Low 42 → 11**, and the entire
`gnutls`/`gcrypt` OS-CVE class that never cleared on rebuilds is **removed
outright** (not just patched). Five distroless porting gaps had to be solved to
get there — see "What broke and how we fixed it".

## Why

A large, recurring class of our Vanta/Inspector findings is OS-library CVEs in
the base image — e.g. `gnutls28` (`3.7.9-2+deb12u6` → needs `deb12u7`) and
`libgcrypt20` (`1.10.1-3` → needs `deb12u1`). Debian _publishes_ the fixes, but
our `Dockerfile` only `apt-get install`s a handful of named packages and never
runs `apt-get upgrade`, so a rebuild keeps whatever `node:24-slim` baked in.
These findings therefore never clear on a rebuild — they sit open until someone
hand-bumps a package. (The forecaster now classifies exactly these as
`apt-update-available` rather than pretending a rebuild fixes them.)

Two ways out were discussed with the team:

1. **Roll our own weekly base image** with `apt-get upgrade` baked in.
2. **Adopt Docker Hardened Images** — let Docker do the continuous patching.

This spike investigates option 2.

## What DHI is (June 2026)

- **Continuously rebuilt, near-zero-CVE images.** Docker watches CVE feeds and
  rebuilds on upstream fixes, so the patched `gnutls`/`gcrypt` land without us
  tracking them. This directly kills the `apt-update-available` class.
- **DHI Community is now free** (Apache-2.0), pullable directly from `dhi.io`
  with no subscription and no Hub mirror. Mirroring/SLA/FIPS/STIG/ELS remain
  paid (Select/Enterprise) but we don't need them for this.
- **Distroless runtime variants:** no shell, no package manager, non-root by
  default. A separate `-dev` variant per image carries apt/bash/pip/root for
  build stages.
- Tags encode `version-distro-variant`, e.g. `dhi.io/python:3.11-debian12` and
  `dhi.io/python:3.11-debian12-dev`.

Sources: Docker DHI docs (`docs.docker.com/dhi`), the public catalog repo
(`github.com/docker-hardened-images/catalog`).

## The prior blocker is resolved

The earlier scoping pass stalled because "the hardened image didn't include our
Python version" (and we can't move off 3.11 — 3.12 breaks deps). The catalog
now ships **Python 3.11 on debian-12** (`image/python/debian-12/3.11.yaml`,
exact `3.11.15-debian12`, EOL 2027-10-31), runtime _and_ `-dev`. Node 24 on
debian-12 exists too (`24.16.0-debian12`).

Staying on **debian-12 (bookworm)** for both is deliberate: it matches the
glibc of today's `node:24-slim`, so the gbstats venv and the compiled
`kerberos` addon stay ABI-compatible. debian-13 (trixie) variants exist but
would be a separate, riskier jump.

## The real problem: one image, two runtimes

GrowthBook's runtime image is **polyglot** — it runs Node 24 _and_ shells out to
Python 3.11:

- `pm2-runtime` (Node) supervises the Express back-end and the Next.js
  front-end (`ecosystem.config.js`).
- The back-end spawns a long-lived Python stats server —
  `packages/back-end/src/services/python.ts` runs bare `python3` (or
  `ddtrace-run python3` when `GB_ENABLE_PYTHON_DD_PROFILING` is set) over
  stdin/stdout, using the `gbstats` venv at `/opt/venv`.

DHI images are single-purpose and distroless — there is no "node + python"
image, and you can't `apt-get install python` into a hardened node runtime.
So the final image has to be **assembled by COPY** from multiple stages.

### Chosen approach (in `Dockerfile.dhi`)

Final base = **DHI `node:24-debian12` runtime** (Node is the entrypoint /
supervisor), then copy everything else in:

| Need                                          | How it's satisfied                                                                                                                                      |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Python 3.11 interpreter                       | `COPY --from=pybuild /opt/python` — DHI python is fully self-contained under `/opt/python`, so it relocates cleanly into the node image                 |
| gbstats venv                                  | `COPY --from=pybuild /opt/venv`, **built against the DHI python** so its `pyvenv.cfg`/shebangs point at `/opt/python` (which exists in the final image) |
| `python3` / `ddtrace-run` on PATH             | `ENV PATH=/opt/venv/bin:/opt/python/bin:...` (venv first → gbstats interpreter wins)                                                                    |
| Kerberos libs for the `kerberos` native addon | staged from `debian:12-slim` and copied into `/usr/lib/x86_64-linux-gnu` (hardened node runtime ships none)                                             |
| Node app                                      | `COPY --from=nodebuild` packages / node_modules / package.json                                                                                          |

Build stages (`pybuild` on the DHI python **-dev** variant, `nodebuild` left on
`node:24-slim`) keep apt/compilers; only the **final** image is hardened. Build
-stage CVEs don't ship, so that's fine and keeps the diff small.

### Why not the alternatives

- **DHI node _dev_ variant as the final base** (keeps shell/apt/root): far
  closer to the current Dockerfile and lower-risk to get booting, but it's not
  distroless/non-root, so we forfeit most of the attack-surface win. Reasonable
  fallback if the distroless assembly fights us, but not the target.
- **Split gbstats into its own container** (DHI python runtime, separate
  service): architecturally the cleanest DHI fit, but `python.ts` assumes an
  in-process child over stdio — turning it into a network service is a real
  back-end change, out of scope for a first spike. Worth revisiting if the
  copy-Python-in approach proves brittle.

## Risks & follow-ups (status)

Originally flagged as boot-test unknowns; current status after a working build:

1. ✅ **pm2 in distroless** — RESOLVED. Not a writable-home issue as first
   guessed; pm2 shells out for metrics (gap #2 above). Replaced with the
   shell-free supervisor.
2. ✅ **Kerberos** — RESOLVED via from-source build (gap #3) + the GSSAPI
   dlopen closure (gap #4). **Functionally verified**: a probe calling
   `kerberos.initializeClient(...)` returns `init OK` (the native `gss_*` calls
   execute and return a client handle), so it's not just loadable — the lib
   stack works at runtime. Full GSSAPI _auth_ against a real KDC is NOT tested
   (needs MongoDB Enterprise + a KDC); deferred unless a deployment uses it.
3. ✅ **No compiler in the python -dev stage** — held; all gbstats deps resolve
   to manylinux wheels today. Still true that a future sdist-only dep would
   break the build (add a compiler then).
4. ✅ **libssl / python `ssl`** — implicitly proven: gbstats + ddtrace import and
   run. SCRAM Mongo works.
5. ✅ **Read-only root filesystem** — VERIFIED locally. Boots clean, serves, and
   refreshes experiment results under `docker run --read-only` given writable
   mounts for `/tmp`, `.next/cache`, and `uploads`, plus
   `PYTHONDONTWRITEBYTECODE=1` + `NEXT_TELEMETRY_DISABLED=1` (now baked into
   `Dockerfile.dhi`). ⚠️ Still pending: the _authoritative_ test — the chart
   deployed to k8s with `readOnlyRootFilesystem: true` and the three writable
   paths as `emptyDir`s — in staging.
6. ✅ **Launch command** — RESOLVED (this was the real issue behind the dead
   `bin/yarn` shim). The Helm chart launches each pod with
   `pm2-runtime ... --only <app>`, which is fatal on distroless (sh-shim +
   getconf). Fixed: `bin/dhi-supervisor.js` now accepts `--only front-end|back-end`
   (verified both), so the DHI chart `command` becomes
   `[/usr/local/bin/node, bin/dhi-supervisor.js, --only, <app>]`. The `bin/yarn`
   bash shim itself stays dead in the image but is harmless — nothing in deploy
   invokes it. ⚠️ Separate open item: `preview/idle-monitor.sh` (bash +
   `pkill pm2-runtime`) breaks on distroless, so the Fly preview path needs its
   own port before previews build on DHI.
7. ✅ **`.ts`/`.tsx` cleanup** — the stock final-stage `RUN` is gone; front-end
   serves correctly, so the build-stage state is sufficient. Revisit only if a
   stray `.ts` ever causes Next to pull in TypeScript.

### Other observations (non-blocking)

- **Mongo `saslprep` warning** (`no saslprep library specified`) — cosmetic and
  **pre-existing**, not a DHI regression: `@mongodb-js/saslprep` is dropped by
  the `--prod --no-optional` install (same in the stock image). Only matters for
  non-ASCII Mongo passwords. Left as-is.
- **`/usr/bin/env`** is copied in as cheap insurance for `#!/usr/bin/env node`
  scripts; nothing on the proven boot path needed it, so it can likely be
  dropped to shave surface.
- **`/opt/pydeps` is load-bearing** — it must be regenerated whenever
  `packages/stats` dependencies change (new wheel → possibly new system lib).
- **WORKDIR** is `/usr/local/src/app` — reverted from a brief `/app` experiment
  to match the stock image AND the Helm chart, which hardcodes paths like the
  uploads mount (`/usr/local/src/app/packages/back-end/uploads`). Keeping them
  aligned avoids chart `volumeMounts` overrides.

## Open decisions for productionizing (beyond the spike)

- **Chart `command` for DHI**: switch the two pods to
  `[/usr/local/bin/node, bin/dhi-supervisor.js, --only, <app>]` (the chart's
  `pm2-runtime` form is fatal on distroless). The shared chart still serves the
  stock image, so this is a DHI-specific values override, not a chart rewrite.
- **k8s read-only rootfs**: enable `readOnlyRootFilesystem: true` +
  `runAsNonRoot` + `runAsUser: 1000` (already scaffolded in the chart) and add
  `emptyDir`s for `/tmp`, `.next/cache`, `uploads`. Then run the authoritative
  staging test (risk #5).
- **Preview pipeline**: `preview/idle-monitor.sh` (bash) and the
  `cat Dockerfile preview/Dockerfile.append` build need porting before per-PR
  previews can build on DHI (Fly, not k8s — so previews can't validate the
  securityContext anyway).
- **Kerberos**: confirmed needed (back-end fails to boot without the addon, even
  for SCRAM, because `mongodb` requires it eagerly). Keep the source build +
  `/opt/krb5deps`. Full GSSAPI auth test deferred unless a deployment uses it.
- Whether to also harden the **build stages** (currently `node:24-slim` /
  `debian:12-slim`) — not required since they don't ship, but tidies the SBOM.

## What broke and how we fixed it (summary)

The DHI node runtime is distroless (no shell, no package manager, non-root,
minimal libs). Porting GrowthBook surfaced six distinct gaps, each fixed in
`Dockerfile.dhi` / `bin/dhi-supervisor.js`. Details below.

| #   | Symptom                                                                                 | Root cause                                                                                                                | Fix                                                                                                         |
| --- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | `exec node_modules/.bin/pm2-runtime: no such file or directory`                         | pnpm `.bin/*` are `#!/bin/sh` shims; distroless has no `/bin/sh`                                                          | Don't exec the shim — `node` the package's real entry directly                                              |
| 2   | back-end crashes on first pageload: `spawn /bin/sh -c "getconf CLK_TCK" ENOENT`         | pm2's `pidusage` shells out for metrics; also wants writable `$HOME`                                                      | Replace pm2 with a shell-free Node supervisor (`bin/dhi-supervisor.js`)                                     |
| 3   | `Cannot find module '../build/Debug/kerberos.node'`                                     | `node-gyp-build` picks a libc-tagged prebuilt via runtime detection that fails on distroless; `build/Release` empty       | `pnpm rebuild kerberos` → from-source compile, loaded by path                                               |
| 4   | `Opening library libgssapi_krb5.so.2 failed`                                            | kerberos `dlopen`s it by name (invisible to `ldd`); it's in `libgssapi-krb5-2`, not `libkrb5-3`                           | Install `libgssapi-krb5-2`, copy lib + full `ldd` closure to `/opt/krb5deps`                                |
| 5   | `libz.so.1` then `libffi.so.8: cannot open shared object file` (masked by numpy/pandas) | Copying `/opt/python` doesn't bring Python's **system-lib** closure; node base lacks it                                   | Stage venv `ldd` closure + `dpkg -L` of the DHI python image's lib packages → `/opt/pydeps`                 |
| 6   | Chart pods crash: `pm2-runtime ... --only <app>` hits the sh-shim + getconf             | Helm chart launches each pod via pm2 (gaps #1/#2) — the prod path differs from the single-container `CMD` we first tested | Supervisor gained `--only front-end\|back-end`; chart `command` → `node bin/dhi-supervisor.js --only <app>` |

Recurring lesson: distroless removes the conveniences (shell, package manager,
broad libs, libc-detection inputs) that countless tools silently assume. Errors
are often **masked** (kerberos's loader, numpy/pandas) — `require()`/import the
artifact directly to see the real cause instead of trusting the surface message.

## Results (docker scout, same source, linux/amd64)

`quickview`:

| Image                                        | Critical |  High  | Medium |  Low   | Unspecified |
| -------------------------------------------- | :------: | :----: | :----: | :----: | :---------: |
| `growthbook:stock` (`node:24-bookworm-slim`) |    0     | **16** | **11** | **42** |      1      |
| `growthbook:dhi` (DHI `node:24-debian12`)    |    0     | **6**  | **5**  | **11** |      0      |

Also: 190 fewer packages (5281 → 5091), ~10 MB smaller, no `/bin/sh`, runs as
uid 1000. Full diff saved in `dhi-cves.md` (`docker scout compare`).

**The `apt-update-available` class is gone, not patched.** The packages our
forecaster flagged as "Debian published the fix but a plain rebuild can't pull
it" are removed from the image entirely:

| Package (stock version)         | Status in DHI | Vulns removed       |
| ------------------------------- | ------------- | ------------------- |
| `gnutls28` `3.7.9-2+deb12u6`    | removed       | 13 (8H, 2M, 2L, 1?) |
| `libgnutls30` `3.7.9-2+deb12u6` | removed       | (same closure)      |
| `libgcrypt20` `1.10.1-3`        | removed       | 3 (3L)              |

They were present in stock because the base/`libkrb5` chain pulled them; the
hardened base doesn't ship them, and our MIT-krb5 closure links `libcrypto`
(OpenSSL), not gnutls — so the class disappears rather than needing a perpetual
chase for `deb12u7`. This is the core thesis of the spike, confirmed: a
continuously-rebuilt hardened base structurally eliminates the OS-CVE class that
a frozen `apt-get install`-only base leaves open indefinitely.

## Boot-test findings (live)

- **`exec node_modules/.bin/pm2-runtime: no such file or directory`.** pnpm
  generates `.bin/*` as POSIX `#!/bin/sh` shim scripts, not symlinks. The
  distroless runtime has no `/bin/sh`, so the shim's interpreter is missing and
  `execve` returns ENOENT against the script. (Confirmed by running `node` as a
  probe inside the image: `lstat false`, `shebang "#!/bin/sh"`.) This is exactly
  why stock `node:24-slim`, which ships `/bin/sh`, runs the same CMD fine.
  **Fix taken:** invoke `node` directly on pm2's real entry
  (`node_modules/pm2/bin/pm2-runtime`) to stay shell-free, rather than adding a
  shell back. Fallback if pm2 needs a shell internally: copy in a minimal
  busybox `/bin/sh` (forfeits the no-shell hardening property).
  - General lesson: in a shell-less runtime, **don't exec `node_modules/.bin/*`
    shims** — call the underlying `node <pkg>/bin/...` directly.

- **pm2 is incompatible with distroless — replaced, not patched.** Once the
  entrypoint ran, pm2 crashed the back-end on first pageload via
  `spawn /bin/sh -c "getconf CLK_TCK" ENOENT` — pm2's `pidusage` metrics shell
  out. pm2 also wants a writable `$HOME` and re-implements restart/monitoring the
  orchestrator already does. Rather than bolt a shell back on (the "thousand
  cuts" anti-pattern, and it forfeits the no-shell property), pm2 is replaced by
  `bin/dhi-supervisor.js`: a ~70-line Node supervisor that forks the same two
  processes from `ecosystem.config.js`, forwards SIGTERM/SIGINT, and exits the
  container if either child dies (orchestrator restarts it). Dropped vs pm2:
  in-container autorestart (`PM2_AUTORESTART` already defaulted off) and
  `max_memory_restart` — both delegated to the platform. This change is scoped to
  `Dockerfile.dhi`; the stock image still uses pm2.

- **kerberos addon fails to resolve — fatal, now fixed by a source build.**
  `Cannot find module '../build/Debug/kerberos.node'` is a path-resolution
  failure: `kerberos@2.2.2` loads via `node-gyp-build`, which picks a libc-tagged
  _prebuilt_ binary using runtime glibc/musl detection. That detection needs
  `ldd` / a populated `/etc`, which the distroless runtime lacks, so no prebuilt
  matches, `build/Release` is empty (a prebuilt shipped, so nothing was compiled),
  and it falls through to a non-existent `build/Debug` and throws at require time.
  (Earlier it looked non-fatal only because pm2 reported the process "online"
  before it crashed; the shell-free supervisor surfaced it as the real boot
  failure.) **Fix:** `pnpm rebuild kerberos` in the nodebuild stage forces a
  from-source compile, so a literal `build/Release/kerberos.node` exists and is
  loaded by path with no libc detection. The `libkrb5` `.so`s copied in stage 4
  are the runtime link target and are now genuinely used. A build-time `test -f`
  guard fails the build if the binary isn't produced.
  - General lesson: **prebuilt native addons that do runtime libc detection can
    break on distroless** — force a source build so the binary is found by path.

- **kerberos `dlopen`s its GSSAPI lib by name — wrong package + wrong discovery
  method.** With the binary present, the next failure was
  `Opening library libgssapi_krb5.so.2 failed`. kerberos calls
  `dlopen("libgssapi_krb5.so.2")` at runtime, so the lib is NOT an ELF `NEEDED`
  of `kerberos.node` — meaning (a) `ldd kerberos.node` can't discover it, and
  (b) it ships in `libgssapi-krb5-2`, which `libkrb5-3` doesn't pull in, so the
  earlier cherry-picked `COPY libgssapi_krb5.so.2*` glob matched nothing and
  BuildKit silently allowed the empty wildcard. **Fix:** install
  `libgssapi-krb5-2` in the krb5libs stage and copy that lib **plus its full
  `ldd` closure** (incl. `libcrypto`/`libssl`, excluded from the DHI node base)
  into `/opt/krb5deps`, added to `LD_LIBRARY_PATH`. The masking loader (see
  above) hid the real `dlopen` error behind a `Cannot find module` — confirmed
  by `require()`-ing the `.node` directly in a `node` probe.
  - General lesson: **`ldd` is blind to `dlopen`** — for addons that load libs
    by name at runtime, find the dlopen target's package and copy ITS closure.

- **Copying `/opt/python` doesn't bring Python's system-lib closure.** With
  kerberos fixed and the app serving, the first stats run failed with
  `libz.so.1: cannot open shared object file` (masked by pandas behind numpy's
  "import from source directory" catch-all — same masking pattern again).
  `/opt/python` + the venv are self-contained for Python _code_, but the
  interpreter's C extensions and the wheels (numpy/pandas/scipy/ddtrace)
  dynamically link OS libraries the DHI **python** image ships as packages
  (`zlib1g`, `libbz2`, `liblzma`, `libffi`, `libsqlite3`, plus numpy/scipy's
  `libgfortran`/`libquadmath`). Our final base is the DHI **node** runtime,
  which has none of them. **Fix (two parts):** in the pybuild stage, (1) `ldd`
  every `.so` under `/opt/venv` + `/opt/python` to catch the wheels' bundled libs
  (openblas/gfortran/quadmath, libz), and (2) — because that sweep scans the
  venv but misses the interpreter's `lib-dynload` stdlib extensions — also copy
  the stdlib system deps deterministically via `dpkg -L` of the exact packages
  the DHI python image installs (`libffi8`, `libsqlite3-0`, `libbz2-1.0`,
  `liblzma5`, `libreadline8`, …). Both land in `/opt/pydeps`, copied into the
  runtime and added to `LD_LIBRARY_PATH`. The `ldd`-sweep-alone attempt staged
  14 libs, all venv deps and zero stdlib deps — hence `libz` worked (numpy) but
  `libffi` didn't (`_ctypes`); the `dpkg` pass closes that gap authoritatively.
  - **Structural note:** this is the cost of a node-primary base hosting Python.
    Had the app been Python-primary, basing the final image on the DHI _python_
    runtime (which already ships these OS libs) and copying Node in would avoid
    this. For GrowthBook, Node is the entrypoint/supervisor, so node-base +
    imported Python lib-closure is the right tradeoff — but the closure copy is
    load-bearing and must travel with any dependency change in `packages/stats`.

## How to try it

```bash
# DHI Community is free; you may still need `docker login` once.
docker build -f Dockerfile.dhi -t growthbook:dhi .
docker run --rm -p 3000:3000 -p 3100:3100 growthbook:dhi
# then exercise: app loads, an experiment that runs gbstats, a Mongo connection.
```

If it boots, scan it (`docker scout cves growthbook:dhi`) and compare the OS
findings against the stock image — the `gnutls`/`gcrypt` family should be gone.
