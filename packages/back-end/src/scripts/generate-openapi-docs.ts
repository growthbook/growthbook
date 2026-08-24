/**
 * Regenerates the Mintlify API reference from generated/spec.yaml:
 *
 *   - docs/openapi.yaml                    the spec Mintlify renders from
 *   - docs/api/<tag>/operation/<id>.mdx    one stub page per endpoint
 *   - docs/api/<Model>_model.mdx           one stub page per model
 *   - the API tab navigation in docs/docs.json
 *
 * Runs at the end of `pnpm generate-openapi`, so the docs follow the spec
 * automatically instead of drifting from it.
 */
import path from "path";
import fs from "fs";
import yaml from "js-yaml";
import prettier from "prettier";

const SPEC_PATH = path.join(__dirname, "..", "..", "generated", "spec.yaml");
const DOCS_DIR = path.join(__dirname, "..", "..", "..", "..", "docs");
const API_DIR = path.join(DOCS_DIR, "api");
const DOCS_JSON_PATH = path.join(DOCS_DIR, "docs.json");

const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;

// Badges shown next to a nav group. Not derivable from the spec, so new tags
// start unbadged until someone adds them here.
const NAV_BADGES: Record<string, string> = {
  "features-v2": "v2",
  "feature-revisions-v2": "v2",
  features: "LEGACY",
  "feature-revisions": "LEGACY",
  metrics: "LEGACY",
  releases: "BETA",
  constants: "BETA",
  "constant-revisions": "BETA",
  configs: "BETA",
  "config-revisions": "BETA",
  ContextualBandits: "BETA",
  ContextualBanditQueries: "BETA",
};

interface SpecOperation {
  operationId?: string;
  summary?: string;
  tags?: string[];
}

interface Spec {
  paths: Record<string, Record<string, SpecOperation>>;
  tags: { name: string; "x-displayName"?: string }[];
  "x-tagGroups": { name: string; tags: string[] }[];
}

interface NavGroup {
  group: string;
  tag?: string;
  pages: (string | NavGroup)[];
}

interface DocsConfig {
  navigation: { tabs: { tab: string; groups: NavGroup[] }[] };
}

function frontmatter(fields: Record<string, string>): string {
  const lines = Object.entries(fields).map(
    ([key, value]) => `${key}: ${JSON.stringify(value)}`,
  );
  return ["---", ...lines, "---", ""].join("\n");
}

function writeFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents);
}

/**
 * Removes generated pages that no longer exist in the spec. Only touches
 * `<Model>_model.mdx` files and tag directories (the ones holding an
 * `operation` folder), so hand-written pages like introduction.mdx survive.
 */
function pruneStalePages(expected: Set<string>, keptTags: Set<string>): number {
  let pruned = 0;
  for (const entry of fs.readdirSync(API_DIR, { withFileTypes: true })) {
    const entryPath = path.join(API_DIR, entry.name);
    if (entry.isFile()) {
      if (entry.name.endsWith("_model.mdx") && !expected.has(entryPath)) {
        fs.rmSync(entryPath);
        pruned++;
      }
      continue;
    }
    const operationDir = path.join(entryPath, "operation");
    if (!fs.existsSync(operationDir)) continue;
    if (!keptTags.has(entry.name)) {
      pruned += fs.readdirSync(operationDir).length;
      fs.rmSync(entryPath, { recursive: true });
      continue;
    }
    for (const file of fs.readdirSync(operationDir)) {
      const filePath = path.join(operationDir, file);
      if (!expected.has(filePath)) {
        fs.rmSync(filePath);
        pruned++;
      }
    }
  }
  return pruned;
}

async function run() {
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, "utf8")) as Spec;
  const displayNames = new Map(
    spec.tags.map((tag) => [tag.name, tag["x-displayName"] ?? tag.name]),
  );
  const tagGroup = (name: string) =>
    spec["x-tagGroups"].find((group) => group.name === name)?.tags ?? [];
  const endpointTags = tagGroup("Endpoints");
  const modelTags = tagGroup("Models");

  // The spec Mintlify renders from is a verbatim copy of the generated spec
  fs.copyFileSync(SPEC_PATH, path.join(DOCS_DIR, "openapi.yaml"));

  const expectedFiles = new Set<string>();

  // Endpoint pages, grouped by their first tag and kept in spec path order
  const operationsByTag = new Map<string, string[]>();
  const untagged: string[] = [];
  for (const [urlPath, methods] of Object.entries(spec.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = methods[method];
      if (!operation?.operationId) continue;
      const tag = operation.tags?.[0];
      if (!tag || !endpointTags.includes(tag)) {
        untagged.push(`${method.toUpperCase()} ${urlPath}`);
        continue;
      }
      const filePath = path.join(
        API_DIR,
        tag,
        "operation",
        `${operation.operationId}.mdx`,
      );
      writeFile(
        filePath,
        frontmatter({
          title: operation.summary ?? operation.operationId,
          openapi: `/openapi.yaml ${method.toUpperCase()} ${urlPath}`,
        }),
      );
      expectedFiles.add(filePath);
      operationsByTag.set(tag, [
        ...(operationsByTag.get(tag) ?? []),
        `api/${tag}/operation/${operation.operationId}`,
      ]);
    }
  }

  // Model pages. Tags are named `<SchemaName>_model`.
  for (const tag of modelTags) {
    const filePath = path.join(API_DIR, `${tag}.mdx`);
    writeFile(
      filePath,
      frontmatter({
        title: displayNames.get(tag) ?? tag,
        "openapi-schema": `openapi.yaml ${tag.replace(/_model$/, "")}`,
      }),
    );
    expectedFiles.add(filePath);
  }

  const pruned = pruneStalePages(
    expectedFiles,
    new Set(operationsByTag.keys()),
  );

  // Rebuild the Endpoints and Models nav groups, leaving the rest of docs.json alone
  const docsConfig = JSON.parse(
    fs.readFileSync(DOCS_JSON_PATH, "utf8"),
  ) as DocsConfig;
  const apiTab = docsConfig.navigation.tabs.find((tab) => tab.tab === "API");
  if (!apiTab) throw new Error("No API tab in docs.json");

  const replaceGroup = (name: string, pages: (string | NavGroup)[]) => {
    const index = apiTab.groups.findIndex((group) => group.group === name);
    if (index === -1) throw new Error(`No "${name}" group in the API tab`);
    apiTab.groups[index] = { group: name, pages };
  };

  replaceGroup(
    "Endpoints",
    endpointTags
      .filter((tag) => operationsByTag.has(tag))
      .map((tag) => ({
        group: displayNames.get(tag) ?? tag,
        ...(NAV_BADGES[tag] ? { tag: NAV_BADGES[tag] } : {}),
        pages: operationsByTag.get(tag) ?? [],
      })),
  );
  replaceGroup(
    "Models",
    modelTags.map((tag) => `api/${tag}`),
  );

  const prettierConfig = await prettier.resolveConfig(DOCS_JSON_PATH);
  fs.writeFileSync(
    DOCS_JSON_PATH,
    await prettier.format(JSON.stringify(docsConfig, null, 2), {
      ...prettierConfig,
      parser: "json",
      filepath: DOCS_JSON_PATH,
    }),
  );

  const endpointCount = [...operationsByTag.values()].flat().length;
  console.log(
    `Docs: ${endpointCount} endpoints, ${modelTags.length} models, ${pruned} stale pages removed`,
  );
  if (untagged.length) {
    console.log(
      `Skipped ${untagged.length} untagged operation(s): ${untagged.join(", ")}`,
    );
  }
}

run()
  .then(() => console.log("Done!"))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
