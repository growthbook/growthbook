#!/usr/bin/env node
// Fails if any shipped dependency carries a license we haven't cleared.
// Runs `pnpm licenses` so resolution matches the lockfile, not a node_modules walk.

import { execFileSync } from "node:child_process";

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

const raw = execFileSync("pnpm", ["licenses", "list", "--json", "--prod"], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

const violations = [];
for (const [license, pkgs] of Object.entries(JSON.parse(raw))) {
  for (const pkg of pkgs) {
    if (EXCEPTIONS[pkg.name] || isAllowed(license)) continue;
    violations.push({
      name: pkg.name,
      versions: pkg.versions.join(", "),
      license,
    });
  }
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

console.log("All production dependency licenses are cleared.");
