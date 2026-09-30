import { access } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const reactEntry = join(root, "packages/sdk-react/dist/esm/index.js");
const jsEntry = join(root, "packages/sdk-js/dist/esm/index.mjs");

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

const needJs = !(await exists(jsEntry));
const needReact = !(await exists(reactEntry));

if (!needJs && !needReact) {
  process.exit(0);
}

console.info("[dummy-shop] Building workspace GrowthBook SDKs (dist missing)…");

const result = spawnSync("pnpm", ["build:sdks"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
});

process.exit(result.status ?? 1);
