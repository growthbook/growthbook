# AGENTS.md

## Cursor Cloud specific instructions

### Services overview

GrowthBook is a monorepo (pnpm workspaces) with two main services — a **Next.js front-end** (port 3000) and an **Express back-end** (port 3100) — plus shared libraries and a Python stats engine. See `CLAUDE.md` and `CONTRIBUTING.md` for standard build/lint/test/dev commands.

### Starting services

1. **MongoDB** must be running before the back-end starts. Start it via Docker:
   ```
   docker start mongo || docker run -d -p 27017:27017 --name mongo \
     -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=password mongo:latest
   ```
2. **Dev servers** (front-end + back-end + shared watch): `pnpm dev:apps` (skips Python stats activation). Use `pnpm dev` only if the Poetry virtualenv is set up and you need the stats engine.
3. Shared libraries must be built before running dev servers. If `packages/shared/dist/` is missing, run `pnpm build:deps` first. `pnpm run setup` handles this plus the stats engine install.

### Non-obvious caveats

- The `.env.local` files for back-end and front-end are not checked in. Copy from `.env.example` in each package directory if they are missing.
- `pnpm setup` (the global pnpm command) is different from `pnpm run setup` (the project script). Always use `pnpm run setup` for project initialization.
- The Docker daemon in the Cloud VM uses `fuse-overlayfs` storage driver and `iptables-legacy`. These must be configured before starting `dockerd`.
- `pnpm dev` activates the Python stats virtualenv via `. $(cd packages/stats && poetry env info --path)/bin/activate`. If Poetry is not configured, use `pnpm dev:apps` instead.
- The `onlyBuiltDependencies` field in root `package.json` controls which native addons are allowed to build during install; this avoids interactive `pnpm approve-builds` prompts.
