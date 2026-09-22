#!/usr/bin/env node
/**
 * Fail if any URL in the front-end DocLink registry
 * (`packages/front-end/components/docSections.ts`) points at a docs route or
 * heading anchor that does not exist.
 *
 * `mint broken-links` only sees links written inside `docs/`, so it cannot
 * catch a stale target in the app-side registry. This check closes that gap:
 *
 * - Routes come from every `.mdx`/`.md` file under `docs/` (its path minus the
 *   extension, with `index` collapsing to its directory), plus every `source`
 *   in the `redirects` list of `docs/docs.json`. `docs/snippets` is excluded:
 *   those are includes, not pages.
 * - Anchors come from a page's `#` headings, slugified the way Mintlify does,
 *   with an explicit `{#custom-id}` suffix winning over the heading text.
 * - A registry URL that lands on a redirect `source` is followed one hop
 *   before its anchor is checked.
 * - Every redirect `destination` is asserted to resolve as well, either to a
 *   page (anchor included) or to a file that exists under `docs/` (a few
 *   redirects point at static assets such as a PDF).
 *
 * Zero npm dependencies on purpose: the docs workflow never runs an install.
 * The registry is imported directly; Node >= 22.18 strips the types natively.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// `packages/front-end/package.json` has no `"type": "module"`, so Node warns
// when it reparses the stripped-types registry as ESM. It loads fine; the
// warning would only bury this script's own output.
const emitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const code = typeof args[0] === "object" ? args[0]?.code : args[1];
  if (code === "MODULE_TYPELESS_PACKAGE_JSON") return;
  return emitWarning(warning, ...args);
};

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DOCS_ROOT = path.join(REPO_ROOT, "docs");
/** Includes, not routable pages. */
const EXCLUDED_DIRS = new Set(["snippets"]);

export function slugifyHeading(heading) {
  const explicit = /\{#([\w-]+)\}\s*$/.exec(heading);
  if (explicit) return explicit[1].toLowerCase();

  return heading
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_]+/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Normalize a docs path so `/x`, `/x/` and `/x?y=1` compare equal. */
export function normalizeRoute(route) {
  return route.split("?")[0].replace(/\/+$/, "") || "/";
}

export function toDocsRoute(relativePath) {
  const withoutExt = relativePath
    .split(path.sep)
    .join("/")
    .replace(/\.mdx?$/, "")
    .replace(/(^|\/)index$/, "");
  return normalizeRoute("/" + withoutExt);
}

export function headingAnchors(lines) {
  const anchors = new Set();
  let inCodeFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (!heading) continue;
    const anchor = slugifyHeading(heading[2]);
    if (anchor) anchors.add(anchor);
  }
  return anchors;
}

async function* walkDocs(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir === DOCS_ROOT && EXCLUDED_DIRS.has(entry.name)) continue;
      yield* walkDocs(full);
    } else if (/\.mdx?$/.test(entry.name)) {
      yield full;
    }
  }
}

/** Every docs route mapped to the anchors that page defines. */
async function buildPageAnchors() {
  const pages = new Map();
  for await (const file of walkDocs(DOCS_ROOT)) {
    const route = toDocsRoute(path.relative(DOCS_ROOT, file));
    const source = await readFile(file, "utf8");
    pages.set(route, headingAnchors(source.split(/\r?\n/)));
  }
  return pages;
}

async function buildRedirects() {
  const config = JSON.parse(
    await readFile(path.join(DOCS_ROOT, "docs.json"), "utf8"),
  );
  return new Map(
    (config.redirects ?? []).map(({ source, destination }) => [
      normalizeRoute(source),
      destination,
    ]),
  );
}

/**
 * A handful of redirects point at a static asset rather than a page (e.g. the
 * A/B testing guide PDF). Those resolve if the file is really in the repo.
 */
async function isFileUnderDocs(route) {
  const target = path.resolve(DOCS_ROOT, "." + route);
  if (target !== DOCS_ROOT && !target.startsWith(DOCS_ROOT + path.sep)) {
    return false;
  }
  try {
    return (await stat(target)).isFile();
  } catch {
    return false;
  }
}

async function loadRegistry() {
  const registry = await import(
    "../packages/front-end/components/docSections.ts"
  );
  return { docSections: registry.docSections, docsOrigin: registry.docsOrigin };
}

function selfTest() {
  const cases = [
    () => slugifyHeading("Stopping an Experiment") === "stopping-an-experiment",
    () => slugifyHeading("Auto-Generate Metrics") === "auto-generate-metrics",
    () => slugifyHeading("Custom Title {#custom-id}") === "custom-id",
    () => slugifyHeading("`code` & symbols!") === "code-symbols",
    () => toDocsRoute("index.mdx") === "/",
    () => toDocsRoute("lib/js.mdx") === "/lib/js",
    () => toDocsRoute(path.join("app", "index.mdx")) === "/app",
    () => normalizeRoute("/lib/js/") === "/lib/js",
    () => normalizeRoute("") === "/",
    () =>
      headingAnchors(["# One", "```", "# Fenced", "```", "## Two"]).size === 2,
    () => !headingAnchors(["```", "# Fenced", "```"]).has("fenced"),
  ];
  for (const [index, assertion] of cases.entries()) {
    if (!assertion()) {
      throw new Error(`self-test case ${index + 1} failed`);
    }
  }
}

async function main() {
  selfTest();

  const [{ docSections, docsOrigin }, pageAnchors, redirects] =
    await Promise.all([loadRegistry(), buildPageAnchors(), buildRedirects()]);

  const validRoutes = new Set([...pageAnchors.keys(), ...redirects.keys()]);
  const errors = [];

  // Every redirect must land somewhere real, too.
  for (const [source, destination] of redirects) {
    if (/^https?:\/\//.test(destination)) continue;
    const [rawRoute, anchor] = destination.split("#");
    const route = normalizeRoute(rawRoute);
    const anchors = pageAnchors.get(route);
    if (anchors === undefined) {
      if (await isFileUnderDocs(route)) continue;
      errors.push(
        `redirect ${source} -> ${destination}: no docs page or file for "${route}"`,
      );
      continue;
    }
    if (anchor && !anchors.has(anchor)) {
      errors.push(
        `redirect ${source} -> ${destination}: "${route}" has no "#${anchor}"`,
      );
    }
  }

  for (const [section, value] of Object.entries(docSections)) {
    let target = value;
    if (/^https?:\/\//.test(target)) {
      // Off-site links cannot be checked without network access.
      if (!target.startsWith(docsOrigin)) continue;
      target = target.slice(docsOrigin.length);
    }
    const url = docsOrigin + value;
    const [rawRoute, anchor] = target.split("#");
    const route = normalizeRoute(rawRoute);

    if (!validRoutes.has(route)) {
      errors.push(`${section}: ${url} — no docs page for "${route}"`);
      continue;
    }
    if (!anchor) continue;

    // A redirect source has no headings of its own, so follow it one hop.
    const page = normalizeRoute((redirects.get(route) ?? route).split("#")[0]);
    const anchors = pageAnchors.get(page);
    // Redirects that leave the page tree (static assets) have no anchors.
    if (anchors === undefined) continue;

    if (!anchors.has(anchor)) {
      errors.push(`${section}: ${url} — "${page}" has no "#${anchor}"`);
    }
  }

  if (errors.length > 0) {
    process.stderr.write(
      `Found ${errors.length} broken docs link${errors.length === 1 ? "" : "s"}:\n\n`,
    );
    for (const error of errors) {
      process.stderr.write(`${error}\n`);
    }
    process.stderr.write(
      `\nFix them in packages/front-end/components/docSections.ts (or docs/docs.json).\n`,
    );
    process.exit(1);
  }
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  await main();
}
