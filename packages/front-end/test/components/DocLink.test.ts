import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  docTitleForSection,
  getDocSectionsForCommandPalette,
} from "@/components/DocLink";

describe("docTitleForSection", () => {
  it("preserves acronyms in generated titles for affected documentation keys", () => {
    expect(docTitleForSection("api")).toBe("API");
    expect(docTitleForSection("sdkWebhooks")).toBe("SDK Webhooks");
    expect(docTitleForSection("encryptedSDKEndpoints")).toBe(
      "Encrypted SDK Endpoints",
    );
    expect(docTitleForSection("apiPostEnvironment")).toBe(
      "API Post Environment",
    );
    expect(docTitleForSection("gtmSetup")).toBe("GTM Setup");
    expect(docTitleForSection("gtmCustomTracking")).toBe("GTM Custom Tracking");
    expect(docTitleForSection("url_redirects")).toBe("URL Redirects");
    expect(docTitleForSection("hashSecureAttributes")).toBe(
      "Hash Secure Attributes",
    );
  });

  it("keeps display-title overrides unchanged", () => {
    expect(docTitleForSection("javascript")).toBe("JavaScript SDK");
  });
});

describe("getDocSectionsForCommandPalette", () => {
  it("exposes corrected acronym titles in palette rows", () => {
    const rows = getDocSectionsForCommandPalette();
    const titleBySection = new Map(rows.map((r) => [r.section, r.title]));

    expect(titleBySection.get("api")).toBe("API");
    expect(titleBySection.get("sdkWebhooks")).toBe("SDK Webhooks");
    expect(titleBySection.get("encryptedSDKEndpoints")).toBe(
      "Encrypted SDK Endpoints",
    );
    expect(titleBySection.get("apiPostEnvironment")).toBe(
      "API Post Environment",
    );
    expect(titleBySection.get("gtmSetup")).toBe("GTM Setup");
    expect(titleBySection.get("gtmCustomTracking")).toBe("GTM Custom Tracking");
    expect(titleBySection.get("url_redirects")).toBe("URL Redirects");
    expect(titleBySection.get("hashSecureAttributes")).toBe(
      "Hash Secure Attributes",
    );
  });
});

/**
 * The docs site is Mintlify: a page's route is its path under `docs/` minus
 * the extension (`docs/lib/js.mdx` -> `/lib/js`), plus the `redirects` in
 * `docs/docs.json` and anything served out of `docs/static/`. Anchors come
 * from a page's Markdown headings, slugified the way Mintlify does, or from
 * an explicit `{#custom-id}` suffix on the heading.
 */
const DOCS_ORIGIN = "https://docs.growthbook.io";
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const DOCS_ROOT = path.join(REPO_ROOT, "docs");

function slugifyHeading(heading: string): string {
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

function walk(dir: string, keep: (name: string) => boolean): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, keep);
    return keep(entry.name) ? [full] : [];
  });
}

function toDocsRoute(file: string): string {
  const rel = path.relative(DOCS_ROOT, file).split(path.sep).join("/");
  return "/" + rel.replace(/\.mdx?$/, "").replace(/(^|\/)index$/, "");
}

/** Frontmatter `slug` is Docusaurus leftovers, so accept it as well. */
function frontmatterSlug(lines: string[]): string | null {
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  for (const line of lines.slice(1, end)) {
    const match = /^slug:\s*(.*)$/.exec(line);
    if (match) return match[1].trim().replace(/^["']|["']$/g, "") || null;
  }
  return null;
}

function headingAnchors(lines: string[]): Set<string> {
  const anchors = new Set<string>();
  let inCodeFence = false;
  for (const line of lines) {
    if (/^\s*(```|~~~)/.test(line)) {
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (!heading) continue;
    const anchor = slugifyHeading(heading[1]);
    if (anchor) anchors.add(anchor);
  }
  return anchors;
}

/** Every docs route mapped to the anchors that page defines. */
function buildPageAnchors(): Map<string, Set<string>> {
  const pages = new Map<string, Set<string>>();
  for (const file of walk(DOCS_ROOT, (name) => /\.mdx?$/.test(name))) {
    const route = toDocsRoute(file) || "/";
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    const anchors = headingAnchors(lines);
    pages.set(route, anchors);

    const slug = frontmatterSlug(lines);
    if (slug === null) continue;
    const slugRoute = slug.startsWith("/")
      ? slug
      : path.posix.resolve(path.posix.dirname(route), slug);
    if (!pages.has(slugRoute)) pages.set(slugRoute, anchors);
  }
  return pages;
}

function buildRedirects(): Map<string, string> {
  const config = JSON.parse(
    fs.readFileSync(path.join(DOCS_ROOT, "docs.json"), "utf8"),
  ) as { redirects?: { source: string; destination: string }[] };
  return new Map(
    (config.redirects ?? []).map(({ source, destination }) => [
      source,
      destination,
    ]),
  );
}

function staticAssetRoutes(): string[] {
  const staticRoot = path.join(DOCS_ROOT, "static");
  if (!fs.existsSync(staticRoot)) return [];
  return walk(staticRoot, () => true).map(
    (file) => "/" + path.relative(DOCS_ROOT, file).split(path.sep).join("/"),
  );
}

describe("docSections registry", () => {
  const pageAnchors = buildPageAnchors();
  const redirects = buildRedirects();
  const validRoutes = new Set([
    ...pageAnchors.keys(),
    ...redirects.keys(),
    ...staticAssetRoutes(),
  ]);

  it("links to docs routes and anchors that exist", () => {
    const failures: string[] = [];

    for (const { section, url } of getDocSectionsForCommandPalette()) {
      // Every registry URL is `docsOrigin` + path; anything else is off-site
      // and cannot be checked without network access.
      if (!url.startsWith(DOCS_ORIGIN)) continue;

      const target = url.slice(DOCS_ORIGIN.length);
      const hash = target.indexOf("#");
      const anchor = hash === -1 ? "" : target.slice(hash + 1);
      const route =
        (hash === -1 ? target : target.slice(0, hash))
          .split("?")[0]
          .replace(/\/$/, "") || "/";

      if (!validRoutes.has(route)) {
        failures.push(`${section}: ${url} — no docs page for "${route}"`);
        continue;
      }
      if (!anchor) continue;

      // A redirect source has no headings of its own, so follow it one hop.
      const page = (redirects.get(route) ?? route).split("#")[0];
      const anchors = pageAnchors.get(page);
      // Static assets and redirects out of the docs tree have no anchors.
      if (anchors === undefined) continue;

      if (!anchors.has(anchor)) {
        failures.push(`${section}: ${url} — "${page}" has no "#${anchor}"`);
      }
    }

    expect(failures).toEqual([]);
  });
});
