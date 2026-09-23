#!/usr/bin/env node
/**
 * Fail if any URL in the front-end DocLink registry
 * (`packages/front-end/components/docSections.ts`) points at a docs route or
 * heading anchor that does not exist.
 *
 * `mint broken-links` only checks links written in pages under `docs/`, so the
 * registry is written out as a temporary page there (one link per entry) and
 * checked with Mintlify's own route and anchor resolution. The page is deleted
 * afterwards and gitignored in case a run is killed before cleanup.
 *
 * Mintlify does not check the anchor of a link that lands on a `docs.json`
 * redirect source, so entries pointing at one are rejected here: link to the
 * redirect destination instead.
 *
 * Requires the Mintlify CLI on PATH (`npm install -g mint`). The registry is
 * imported directly; Node >= 22.18 strips the types natively.
 * `packages/front-end/package.json` has no `"type": "module"`, so that import
 * needs `--disable-warning=MODULE_TYPELESS_PACKAGE_JSON` on the node command.
 */

import { spawnSync } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { docSections } from "../packages/front-end/components/docSections.ts";

const DOCS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "docs",
);
/** Keep in sync with `docs/.gitignore`. */
const TARGETS_PAGE = "doclink-targets.mdx";

/** `/x`, `/x/` and `/x#y` all name the route `/x`. */
function routeOf(docsPath) {
  return docsPath.split("#")[0].replace(/\/+$/, "") || "/";
}

const { redirects = [] } = JSON.parse(
  await readFile(path.join(DOCS_ROOT, "docs.json"), "utf8"),
);
const redirectDestinations = new Map(
  redirects.map(({ source, destination }) => [routeOf(source), destination]),
);

const errors = [];
const links = [];
for (const [section, docsPath] of Object.entries(docSections)) {
  const destination = redirectDestinations.get(routeOf(docsPath));
  if (destination !== undefined) {
    errors.push(
      `${section}: "${docsPath}" is a redirect to "${destination}"; link to the destination instead`,
    );
    continue;
  }
  links.push(`- [${section}](${docsPath || "/"})`);
}

const targetsPath = path.join(DOCS_ROOT, TARGETS_PAGE);
await writeFile(
  targetsPath,
  `---\ntitle: "DocLink targets"\n---\n\n${links.join("\n")}\n`,
);
let mint;
try {
  mint = spawnSync(
    "mint",
    ["broken-links", "--check-anchors", "--files", TARGETS_PAGE],
    { cwd: DOCS_ROOT, stdio: "inherit" },
  );
} finally {
  await rm(targetsPath, { force: true });
}

if (mint.error) {
  process.stderr.write(
    mint.error.code === "ENOENT"
      ? "Mintlify CLI not found; install it with `npm install -g mint`\n"
      : `mint broken-links failed to run: ${mint.error.message}\n`,
  );
  process.exit(1);
}
if (mint.status !== 0) {
  errors.push("mint broken-links reported broken DocLink targets (see above)");
}

if (errors.length > 0) {
  for (const error of errors) {
    process.stderr.write(`${error}\n`);
  }
  process.stderr.write(
    "\nFix them in packages/front-end/components/docSections.ts (or docs/docs.json).\n",
  );
  process.exit(1);
}
