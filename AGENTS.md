## Cursor Cloud specific instructions

### Services overview

| Service               | Port  | How to run                                              |
| --------------------- | ----- | ------------------------------------------------------- |
| Front-end (Next.js)   | 3000  | `pnpm dev:apps` or `pnpm dev`                           |
| Back-end (Express)    | 3100  | `pnpm dev:apps` or `pnpm dev`                           |
| MongoDB               | 27017 | Docker (see below)                                      |
| Stats engine (Python) | N/A   | Optional; activated by `pnpm dev` (not `pnpm dev:apps`) |

See `CLAUDE.md` for build, lint, test, and type-check commands.

### Starting MongoDB

```bash
sudo dockerd &>/tmp/dockerd.log &
sleep 3
sudo chmod 666 /var/run/docker.sock
docker start mongo 2>/dev/null || docker run -d --name mongo -p 27017:27017 \
  -e MONGO_INITDB_ROOT_USERNAME=root -e MONGO_INITDB_ROOT_PASSWORD=password mongo:latest
```

### Non-obvious caveats

- **Poetry venv must exist before `pnpm install`**: The `postinstall` script activates the Poetry virtual environment. Run `cd packages/stats && poetry install` before the first `pnpm install`, or it will fail.
- **`pnpm dev` vs `pnpm dev:apps`**: `pnpm dev` activates the stats engine Python venv, which requires Poetry setup. Use `pnpm dev:apps` if you only need front-end + back-end + shared.
- **Docker in this environment**: The VM runs inside a container, so Docker needs `fuse-overlayfs` storage driver and `iptables-legacy`. These are configured during initial setup.
- **Node.js 24+ required**: The project enforces `engines.node >= 24`. Use nvm to install Node 24 if the default version is older.
- **Docs workspace**: The `docs/` folder is a separate pnpm workspace. Its dependencies must be installed (`cd docs && pnpm install`) for root-level `pnpm lint` to pass, since ESLint scans docs files too.
- **`.env` files**: Copy `packages/back-end/.env.example` to `packages/back-end/.env` and `packages/front-end/.env.example` to `packages/front-end/.env`. The defaults work for local development with the MongoDB container above.
- **First-time UX**: After registration, you must complete the onboarding wizard (SDK selection) before the "Add Feature" button appears on the Features page.
