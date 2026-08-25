import fs from "fs";
import path from "path";
import { allRoutes } from "back-end/src/api/api.router";

// A skill naming a path that doesn't exist sends the agent into a 404 loop it
// cannot recover from. Both mistakes have happened: no such endpoint, wrong version.
//
// Only the in-repo skills are checked: canonical ones come from growthbook/skills
// and are assembled at build time, so they aren't on disk here.

const SKILLS_DIR = path.join(
  __dirname,
  "..",
  "..",
  "src",
  "agent",
  "skills-local",
);

/** `/api/v1/foo/{a,b}-bar` → ["/api/v1/foo/a-bar", "/api/v1/foo/b-bar"] */
function expandBraceLists(raw: string): string[] {
  const match = raw.match(/\{([^{}]*)\}/);
  if (!match) return [raw];
  return match[1]
    .split(",")
    .map((option) => option.trim())
    .filter((option) => option.length > 0)
    .flatMap((option) =>
      expandBraceLists(
        raw.slice(0, match.index) +
          option +
          raw.slice((match.index ?? 0) + match[0].length),
      ),
    );
}

function routeFullPath(route: { path: string; version?: string }): string {
  return `/api/${route.version ?? "v1"}${route.path}`;
}

const isPlaceholder = (segment: string) =>
  segment.startsWith(":") || segment.includes("<");

// Segment-wise, because a route's `:param` must absorb a documented literal:
// `revisions/new` and `revisions/latest` both land on `revisions/:version`.
function pathMatchesRoute(docPath: string, routePath: string): boolean {
  const doc = docPath.replace(/\/+$/, "").split("/");
  const route = routePath.replace(/\/+$/, "").split("/");
  if (doc.length !== route.length) return false;
  return route.every(
    (routeSegment, i) =>
      routeSegment.startsWith(":") ||
      routeSegment === doc[i] ||
      isPlaceholder(doc[i]),
  );
}

function collectSkillPaths(): { file: string; raw: string }[] {
  const found: { file: string; raw: string }[] = [];

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir)) {
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.endsWith(".md")) continue;

      const text = fs.readFileSync(full, "utf8");
      const matches =
        text.match(/\/api\/v[0-9]+\/[A-Za-z0-9_:<>{},./*-]*/g) ?? [];
      for (const raw of matches) {
        for (const expanded of expandBraceLists(raw)) {
          const trimmed = expanded.replace(/[.,]+$/, "").replace(/\/+$/, "");
          // Prose rather than a reference to one endpoint: a bare `/api/v1`
          // prefix ("paths are relative to …") or a `/api/v1/foo/*` family.
          if (/^\/api\/v[0-9]+$/.test(trimmed)) continue;
          if (trimmed.includes("*")) continue;
          found.push({ file: path.relative(SKILLS_DIR, full), raw: trimmed });
        }
      }
    }
  };

  walk(SKILLS_DIR);
  return found;
}

describe("agent skills reference real API endpoints", () => {
  const registered = allRoutes
    .filter((r) => !r.deprecated)
    .map((r) => routeFullPath(r));

  it("has a non-trivial route table and skill corpus to compare", () => {
    // Without this, a mocked-out route table or a moved skills directory would
    // make every assertion below vacuously pass.
    expect(registered.length).toBeGreaterThan(50);
    expect(collectSkillPaths().length).toBeGreaterThan(10);
  });

  it("documents no endpoint that isn't registered", () => {
    const unknown = collectSkillPaths()
      .filter(
        ({ raw }) =>
          !registered.some((routePath) => pathMatchesRoute(raw, routePath)),
      )
      .map(({ file, raw }) => `${file}: ${raw}`);

    expect([...new Set(unknown)].sort()).toEqual([]);
  });
});
