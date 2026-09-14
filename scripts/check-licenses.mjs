#!/usr/bin/env node
// Fails if any shipped dependency carries a license we haven't cleared.
// Reads the installed prod tree rather than `pnpm licenses`, which resolves against
// the lockfile and fails on a CI store that never fetched an unused optional peer.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

// Permissive licenses that need no review.
const ALLOWED = new Set([
  "0BSD",
  "Apache-2.0",
  "BlueOak-1.0.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "CC0-1.0",
  "CC-BY-4.0",
  "ISC",
  "MIT",
  "MIT-0",
  "MIT/X11",
  "Python-2.0",
  "Unlicense",
  "WTFPL",
  "Zlib",
]);

// Cleared case by case. Keep the reason: it's what we show the next auditor.
const EXCEPTIONS = {
  "@img/sharp-libvips-linux-x64":
    "LGPL-3.0 prebuilt binary, dynamically loaded and unmodified",
  "@img/sharp-libvips-linux-arm64":
    "LGPL-3.0 prebuilt binary, dynamically loaded and unmodified",
  "@sentry/cli": "FSL-1.1-MIT, build-time only, not linked into the app",
  "@sentry/cli-linux-x64":
    "FSL-1.1-MIT, build-time only, not linked into the app",
  "@sentry/cli-linux-arm64":
    "FSL-1.1-MIT, build-time only, not linked into the app",
  flatbuffers:
    "Apache-2.0 upstream; the published package omits the license field",
  "seq-queue": "MIT per its bundled LICENSE; no license field in package.json",
  "url-template":
    'BSD-3-Clause upstream; declared as the non-SPDX string "BSD"',
};

// SPDX expressions: OR needs one allowed branch, AND needs all of them.
function isAllowed(expr) {
  const clean = expr
    .trim()
    .replace(/^\((.*)\)$/s, "$1")
    .trim();
  if (/\sOR\s/i.test(clean)) return splitTop(clean, "OR").some(isAllowed);
  if (/\sAND\s/i.test(clean)) return splitTop(clean, "AND").every(isAllowed);
  return ALLOWED.has(clean.replace(/\+$/, ""));
}

function splitTop(expr, op) {
  const parts = [];
  let depth = 0;
  let last = 0;
  const re = new RegExp(`\\s${op}\\s`, "gi");
  for (let i = 0; i < expr.length; i++) {
    if (expr[i] === "(") depth++;
    else if (expr[i] === ")") depth--;
    else if (depth === 0) {
      re.lastIndex = i;
      const m = re.exec(expr);
      if (m && m.index === i) {
        parts.push(expr.slice(last, i));
        last = i = re.lastIndex - 1;
      }
    }
  }
  parts.push(expr.slice(last));
  return parts.map((p) => p.trim());
}

// package.json carried `licenses: [{type}]` before SPDX; a few old deps still do.
function declaredLicense(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license?.type) return pkg.license.type;
  const legacy = (pkg.licenses ?? []).map((l) => l.type ?? l).filter(Boolean);
  return legacy.length ? legacy.join(" OR ") : "UNKNOWN";
}

const raw = execFileSync(
  "pnpm",
  ["-r", "list", "--prod", "--depth", "Infinity", "--json"],
  { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
);

// Collect every node carrying a path. `pnpm list` prints a repeated subtree in
// full at one position and bare elsewhere, so recursion can't stop at a package
// already recorded — only the recording is deduped.
const seen = new Set();
const installed = [];
function collect(value) {
  if (Array.isArray(value)) return value.forEach(collect);
  if (!value || typeof value !== "object") return;
  // Workspace packages are ours; only real installs live under node_modules.
  const dir = value.path;
  if (
    typeof dir === "string" &&
    dir.includes(`${path.sep}node_modules${path.sep}`) &&
    !seen.has(dir)
  ) {
    seen.add(dir);
    installed.push(dir);
  }
  for (const child of Object.values(value)) collect(child);
}
collect(JSON.parse(raw));

const violations = [];
let unread = 0;
for (const dir of installed) {
  let pkg;
  try {
    pkg = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
  } catch {
    unread++; // another platform's optional binary; nothing on disk to read
    continue;
  }
  const license = declaredLicense(pkg);
  if (EXCEPTIONS[pkg.name] || isAllowed(license)) continue;
  violations.push({ name: pkg.name, versions: pkg.version, license });
}

if (violations.length) {
  console.error(`\n${violations.length} dependency license(s) need review:\n`);
  for (const v of violations) {
    console.error(`  ${v.name}@${v.versions}  ${v.license}`);
  }
  console.error(
    "\nReplace the dependency, or add it to EXCEPTIONS in scripts/check-licenses.mjs\n" +
      "with a reason once legal has cleared it.\n",
  );
  process.exit(1);
}

console.log(
  `All ${installed.length - unread} production dependency licenses are cleared` +
    // Not a hole this check can close: their package.json only exists on that platform.
    `, plus ${unread} not installed for this platform and so unread.`,
);
