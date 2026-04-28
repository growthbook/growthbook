/**
 * Production feature migration / API-shape comparison tool.
 *
 *   1) fetch  — Per month: find() matching dateCreated, sort, limit 20; then fetch orgs; write snapshot.
 *   2) run1   — On main: toInterface(FeatureModel) then getApiFeatureObj → v1.json (keys sorted for diffs)
 *   3) run2   — On this branch: toInterface(FeatureModel) then getApiFeatureObj → v2.json (keys sorted)
 *   4) diff   — Recursive JSON diff between v1 and v2 outputs (no library deps).
 *
 * `run1` / `run2` / `diff` accept an optional `--in <path>` to swap the
 * default `prod-sample-features.generated.json` snapshot. The path is resolved
 * relative to this script's directory; absolute and `~/...` paths pass through.
 *
 * `--in` accepts either:
 *   • a bare `LegacyFeatureInterface[]` JSON array (raw mongo docs), with orgs
 *     auto-discovered as `<stem>_orgs.json` / `orgs.json` next to it
 *     (override via `--orgs <path>`); falls back to the canonical orgs dump.
 *   • a self-contained envelope: `{ "features": [...], "orgs": {...} }`.
 *
 * Outputs land alongside the input as `<stem>_v1.json` / `<stem>_v2.json`.
 *
 * Data files (PII): set GB_TEST_FEATURES_DATA_DIR to an absolute path outside the repo
 * (optional leading `~/` is expanded). Defaults to ~/Downloads/. Never commit dumps.
 *
 * Usage (from packages/back-end):
 *   pnpm exec tsx src/scripts/diff-features.ts fetch --uri "mongodb://..."
 *   pnpm exec tsx src/scripts/diff-features.ts run1 [--in sample.json]
 *   pnpm exec tsx src/scripts/diff-features.ts run2 [--in sample.json]
 *   pnpm exec tsx src/scripts/diff-features.ts diff [--in sample.json]
 *                                                   [--v1 a.json --v2 b.json]
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  resolve as resolvePath,
} from "node:path";
import { homedir } from "node:os";
import { MongoClient } from "mongodb";
import type { ReqContext } from "back-end/types/request";

/** Keys in v1.json / v2.json: orgId + feature id (globally unique in sample). */
export function compositeFeatureKey(orgId: string, featureId: string): string {
  return `${orgId}::${featureId}`;
}

const ENV_TEST_FEATURES_DATA_DIR = "GB_TEST_FEATURES_DATA_DIR";

function expandLeadingTilde(dir: string): string {
  const trimmed = dir.trim();
  if (trimmed === "~") {
    return homedir();
  }
  if (trimmed.startsWith(`~/`) || trimmed.startsWith("~\\")) {
    return join(homedir(), trimmed.slice(2));
  }
  return trimmed;
}

let cachedDumpDir: string | null = null;

/**
 * Resolved directory for all test-features dumps. Creates the directory if needed.
 * @see ENV_TEST_FEATURES_DATA_DIR
 */
export function getTestFeaturesDataDir(): string {
  if (cachedDumpDir) {
    return cachedDumpDir;
  }
  const raw = process.env[ENV_TEST_FEATURES_DATA_DIR]?.trim();
  const resolved =
    raw && raw.length > 0
      ? expandLeadingTilde(raw)
      : join(homedir(), "Downloads", "features-diff");
  mkdirSync(resolved, { recursive: true });
  cachedDumpDir = resolved;
  return resolved;
}

export function getTestFeaturesDumpPaths() {
  const dir = getTestFeaturesDataDir();
  return {
    dir,
    featuresJson: join(dir, "prod-sample-features.generated.json"),
    orgsJson: join(dir, "prod-sample-orgs.generated.json"),
    v1Json: join(dir, "v1.json"),
    v2Json: join(dir, "v2.json"),
  };
}

const SAMPLE_START = new Date(Date.UTC(2021, 11, 1)); // 2021-12-01

function dateReviver(_key: string, value: unknown): unknown {
  if (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?$/.test(value)
  ) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      return d;
    }
  }
  return value;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8"), dateReviver) as T;
}

function stripMongo<T extends Record<string, unknown>>(doc: T): T {
  const { _id, __v, ...rest } = doc;
  void _id;
  void __v;
  return rest as T;
}

/**
 * Deep-clone JSON data with every object’s keys sorted alphabetically (arrays keep order).
 * Applied when writing v1.json / v2.json so branches can be diffed despite key-order churn.
 */
/**
 * `--stripOutputFields` spec: dot-delimited path matched as a SUFFIX of the
 * object-key trail (arrays are transparent — no `[]` syntax needed). A bare
 * key with no dots matches anywhere. Examples:
 *
 *   `valueType`               → strips every `valueType` key at any depth
 *   `rules.allEnvironments`   → strips `allEnvironments` only when its parent
 *                               object key is `rules` (e.g. on rule entries)
 *   `environments.rules.allEnvironments`
 *                             → only matches when ancestor trail ends with
 *                               `…environments → rules` (more selective)
 *
 * The top-level keys in the API output are `<orgId>::<featureId>` composite
 * IDs, so paths like `feature.rules.foo` won't match anything — start your
 * spec at the object key inside that envelope.
 */
type StripSpec = { key: string; ancestors: string[] };

function parseStripSpecs(csv: Set<string>): StripSpec[] {
  return [...csv].map((spec) => {
    const segs = spec
      .split(".")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return {
      key: segs[segs.length - 1],
      ancestors: segs.slice(0, -1),
    };
  });
}

function trailEndsWith(trail: string[], required: string[]): boolean {
  if (required.length === 0) return true;
  if (trail.length < required.length) return false;
  const offset = trail.length - required.length;
  for (let i = 0; i < required.length; i++) {
    if (trail[offset + i] !== required[i]) return false;
  }
  return true;
}

function stripFieldsImpl(
  value: unknown,
  specs: StripSpec[],
  trail: string[],
): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stripFieldsImpl(v, specs, trail));
  }
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value)) {
      const matched = specs.some(
        (s) => s.key === k && trailEndsWith(trail, s.ancestors),
      );
      if (matched) continue;
      out[k] = stripFieldsImpl(value[k], specs, [...trail, k]);
    }
    return out;
  }
  return value;
}

export function stripFields(value: unknown, specs: Set<string>): unknown {
  if (!specs.size) return value;
  return stripFieldsImpl(value, parseStripSpecs(specs), []);
}

export function sortKeysDeep(value: unknown): unknown {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map(sortKeysDeep);
    }
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort((a, b) => a.localeCompare(b, "en"));
    const out: Record<string, unknown> = {};
    for (const k of keys) {
      out[k] = sortKeysDeep(obj[k]);
    }
    return out;
  }
  return value;
}

// Accepts both `--name value` and `--name=value`.
function readFlag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  if (i !== -1 && typeof args[i + 1] === "string") {
    return args[i + 1];
  }
  const prefix = `${name}=`;
  const eq = args.find((a) => a.startsWith(prefix));
  return eq ? eq.slice(prefix.length) : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function readCsvSetFlag(args: string[], name: string): Set<string> {
  return new Set(
    (readFlag(args, name) ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );
}

// Relative paths resolve against THIS script's directory (so `--in foo.json`
// from anywhere finds `packages/back-end/src/scripts/foo.json`). Absolute paths
// and `~/`-prefixed paths pass through.
function resolveInputPath(p: string): string {
  const expanded = expandLeadingTilde(p);
  return isAbsolute(expanded) ? expanded : resolvePath(__dirname, expanded);
}

/**
 * Map an input features path to its `<stem>_v{1,2}.json` siblings and
 * locate a co-resident orgs snapshot. Resolution order for orgs (first hit
 * wins): explicit `--orgs`; envelope shape inside the input itself; sibling
 * `<stem>_orgs.json`; sibling `orgs.json`; canonical
 * `prod-sample-orgs.generated.json` in the dump dir.
 */
function resolveRunPaths(
  inputPath: string | undefined,
  suffix: "v1" | "v2",
  explicitOrgsPath?: string,
): {
  featuresPath: string;
  orgsPath: string | null;
  outPath: string;
  // True when features+orgs share a single envelope file.
  inputIsEnvelope: boolean;
} {
  const dump = getTestFeaturesDumpPaths();
  if (!inputPath) {
    return {
      featuresPath: dump.featuresJson,
      orgsPath: explicitOrgsPath
        ? resolveInputPath(explicitOrgsPath)
        : dump.orgsJson,
      outPath: suffix === "v1" ? dump.v1Json : dump.v2Json,
      inputIsEnvelope: false,
    };
  }
  const abs = resolveInputPath(inputPath);
  const dir = dirname(abs);
  const ext = extname(abs) || ".json";
  const stem = basename(abs, ext);

  let orgsPath: string | null = null;
  let inputIsEnvelope = false;
  if (explicitOrgsPath) {
    orgsPath = resolveInputPath(explicitOrgsPath);
  } else {
    const candidates = [
      join(dir, `${stem}_orgs${ext}`),
      join(dir, `orgs${ext}`),
    ];
    orgsPath = candidates.find((p) => existsSync(p)) ?? null;
    if (!orgsPath) {
      // Peek at the input — `{ features, orgs }` envelope is allowed.
      try {
        const peek = JSON.parse(readFileSync(abs, "utf8"));
        if (
          peek &&
          typeof peek === "object" &&
          !Array.isArray(peek) &&
          Array.isArray(peek.features) &&
          peek.orgs &&
          typeof peek.orgs === "object"
        ) {
          inputIsEnvelope = true;
          orgsPath = abs;
        }
      } catch {
        // Fall through; loadJson below will surface the syntax error.
      }
    }
    // Intentionally NO fallback to the canonical `dump.orgsJson` when `--in`
    // is set: leaking to a different orgs snapshot than the user's input
    // would silently mismatch the data they're debugging. Force them to make
    // it explicit via `--orgs`, an envelope, or a sibling file.
  }

  return {
    featuresPath: abs,
    orgsPath,
    outPath: join(dir, `${stem}_${suffix}${ext}`),
    inputIsEnvelope,
  };
}

function resolveDiffPaths(args: string[]): { v1Path: string; v2Path: string } {
  const explicitV1 = readFlag(args, "--v1");
  const explicitV2 = readFlag(args, "--v2");
  const inputPath = readFlag(args, "--in");
  const dump = getTestFeaturesDumpPaths();

  const v1Path = explicitV1
    ? resolveInputPath(explicitV1)
    : inputPath
      ? resolveRunPaths(inputPath, "v1").outPath
      : dump.v1Json;
  const v2Path = explicitV2
    ? resolveInputPath(explicitV2)
    : inputPath
      ? resolveRunPaths(inputPath, "v2").outPath
      : dump.v2Json;
  return { v1Path, v2Path };
}

async function cmdFetch(args: string[]) {
  const uri = readFlag(args, "--uri");
  if (!uri) {
    console.error(
      "Usage: tsx src/scripts/diff-features.ts fetch --uri <mongodb connection string>",
    );
    process.exit(1);
  }

  const paths = getTestFeaturesDumpPaths();
  const fromEnv = process.env[ENV_TEST_FEATURES_DATA_DIR]?.trim();
  console.log(
    `Writing dumps to:\n  ${paths.dir}\n${
      fromEnv
        ? `  (from ${ENV_TEST_FEATURES_DATA_DIR})`
        : `  (default: ~/Downloads; set ${ENV_TEST_FEATURES_DATA_DIR} to override)`
    }`,
  );

  const client = new MongoClient(uri, {
    appName: "growthbook-test-features-fetch",
  });
  await client.connect();

  try {
    const db = client.db();
    const featuresColl = db.collection("features");
    const orgsColl = db.collection("organizations");

    const allFeatures: Record<string, unknown>[] = [];
    const now = new Date();

    for (
      let cursor = new Date(SAMPLE_START);
      cursor <= now;
      cursor = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
      )
    ) {
      const monthStart = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 1),
      );
      const monthEnd = new Date(
        Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1),
      );
      const batch = await featuresColl
        .find({
          dateCreated: {
            $gte: monthStart,
            $lt: monthEnd,
          },
        })
        .sort({ _id: 1 })
        .limit(20)
        .toArray();
      const ym = `${monthStart.getUTCFullYear()}-${String(
        monthStart.getUTCMonth() + 1,
      ).padStart(2, "0")}`;
      console.log(
        `${ym}: found ${batch.length} feature(s) (${monthStart.toISOString().slice(0, 10)} …)`,
      );
      for (const doc of batch) {
        allFeatures.push(stripMongo(doc as Record<string, unknown>));
      }

      // Sleep for 100ms
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    const orgIds = [
      ...new Set(
        allFeatures
          .map((f) => f.organization)
          .filter((o): o is string => typeof o === "string" && o.length > 0),
      ),
    ];
    const orgDocs = await orgsColl
      .find({ id: { $in: orgIds } })
      .project({})
      .toArray();
    const orgById: Record<string, Record<string, unknown>> = {};
    for (const doc of orgDocs) {
      const cleaned = stripMongo(doc as Record<string, unknown>);
      const id = cleaned.id;
      if (typeof id === "string") {
        orgById[id] = cleaned;
      }
    }

    writeFileSync(
      paths.featuresJson,
      JSON.stringify(allFeatures, null, 2),
      "utf8",
    );
    writeFileSync(paths.orgsJson, JSON.stringify(orgById, null, 2), "utf8");

    console.log(
      `Wrote ${allFeatures.length} features, ${Object.keys(orgById).length} organizations.`,
    );
    console.log(`  ${paths.featuresJson}`);
    console.log(`  ${paths.orgsJson}`);
  } finally {
    await client.close();
  }
}

// Run-mode body shared by `run1` (executed on `origin/main`) and `run2`
// (executed on this branch). Behavior is identical; the suffix only labels
// the output file so both branches can write side-by-side.
async function runApiObj(suffix: "v1" | "v2", args: string[]) {
  await import("../init/aliases");
  const inputPath = readFlag(args, "--in");
  const explicitOrgsPath = readFlag(args, "--orgs");
  const stripKeys = readCsvSetFlag(args, "--stripOutputFields");
  const paths = resolveRunPaths(inputPath, suffix, explicitOrgsPath);
  console.log(
    `${suffix}: features ${paths.featuresPath}\n${suffix}: orgs     ${paths.orgsPath ?? "(none)"}\n${suffix}: output   ${paths.outPath}`,
  );
  const { FeatureModel, toInterface } = await import("../models/FeatureModel");
  const { getApiFeatureObj } = await import("../services/features");

  if (!existsSync(paths.featuresPath)) {
    console.error(`Missing features file: ${paths.featuresPath}`);
    process.exit(1);
  }
  if (!paths.orgsPath || !existsSync(paths.orgsPath)) {
    console.error(
      `Missing orgs file. Either:\n` +
        `  • place \`<stem>_orgs.json\` (or \`orgs.json\`) next to ${paths.featuresPath}\n` +
        `  • pass \`--orgs <path>\`\n` +
        `  • use a self-contained envelope { "features": [...], "orgs": {...} }\n` +
        `  • or run \`fetch\` to populate ${getTestFeaturesDumpPaths().orgsJson}`,
    );
    process.exit(1);
  }

  type Legacy = import("shared/types/feature").LegacyFeatureInterface;
  type Org = import("shared/types/organization").OrganizationInterface;

  // Envelope (`{ features, orgs }`) bundles both in one file; bare files are
  // an array of legacy features + a sibling `Record<orgId, Org>` map.
  let features: Legacy[];
  let orgById: Record<string, Org>;
  if (paths.inputIsEnvelope) {
    const envelope = loadJson<{
      features: Legacy[];
      orgs: Record<string, Org>;
    }>(paths.featuresPath);
    features = envelope.features;
    orgById = envelope.orgs;
  } else {
    features = loadJson<Legacy[]>(paths.featuresPath);
    orgById = loadJson<Record<string, Org>>(paths.orgsPath);
  }

  if (!Array.isArray(features)) {
    console.error(
      `Features file must be a \`LegacyFeatureInterface[]\` array (raw mongo docs) ` +
        `or a \`{ "features": [...], "orgs": {...} }\` envelope.\n` +
        `Got an object keyed by something else — looks like API output ` +
        `(\`${suffix === "v1" ? "v1" : "v2"}.json\` shape). Re-running migration ` +
        `requires the raw doc; pull it from \`prod-sample-features.generated.json\` ` +
        `or your DB and wrap it in an array.`,
    );
    process.exit(1);
  }

  const out: Record<string, unknown> = {};
  let ok = 0;
  let fail = 0;

  for (const raw of features) {
    const orgId = raw.organization;
    const org = orgById[orgId];
    const key = compositeFeatureKey(orgId, raw.id);
    if (!org) {
      console.error(
        `Skipping feature ${raw.id}: no organization "${orgId}" in snapshot.`,
      );
      out[key] = {
        __skipped: `organization "${orgId}" not in snapshot`,
      };
      fail++;
      continue;
    }
    const context = { org } as ReqContext;

    try {
      const feature = toInterface(new FeatureModel(raw), context);
      out[key] = getApiFeatureObj({
        feature,
        organization: org,
        groupMap: new Map(),
        experimentMap: new Map(),
        revision: null,
        safeRolloutMap: new Map(),
      });
      ok++;
    } catch (e) {
      out[key] = {
        __error: e instanceof Error ? e.message : String(e),
      };
      fail++;
    }
  }

  const scrubbed = stripFields(out, stripKeys);
  writeFileSync(
    paths.outPath,
    JSON.stringify(sortKeysDeep(scrubbed), null, 2),
    "utf8",
  );
  if (stripKeys.size) {
    console.log(
      `${suffix}: stripped fields: ${[...stripKeys].sort().join(", ")}`,
    );
  }
  console.log(
    `${suffix}: wrote ${ok} ok, ${fail} failed → ${paths.outPath} (${features.length} input features)`,
  );
}

// ---------------------------------------------------------------------------
// JSON diff (no library deps)
// ---------------------------------------------------------------------------

type DiffOp =
  | { op: "+"; path: string; after: unknown }
  | { op: "-"; path: string; before: unknown }
  | { op: "~"; path: string; before: unknown; after: unknown };

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Recursive structural diff. Arrays compared positionally; objects compared
 * by key union. Identity by `JSON.stringify` keeps Dates/regexes/etc.
 * tractable without a deepEqual import.
 */
function jsonDiff(
  before: unknown,
  after: unknown,
  path: string,
  out: DiffOp[],
): void {
  if (before === after) return;

  if (Array.isArray(before) && Array.isArray(after)) {
    const max = Math.max(before.length, after.length);
    for (let i = 0; i < max; i++) {
      const subPath = `${path}[${i}]`;
      if (i >= before.length) {
        out.push({ op: "+", path: subPath, after: after[i] });
      } else if (i >= after.length) {
        out.push({ op: "-", path: subPath, before: before[i] });
      } else {
        jsonDiff(before[i], after[i], subPath, out);
      }
    }
    return;
  }

  if (isPlainObject(before) && isPlainObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of [...keys].sort((a, b) => a.localeCompare(b, "en"))) {
      const subPath = path ? `${path}.${key}` : key;
      if (!(key in before)) {
        out.push({ op: "+", path: subPath, after: after[key] });
      } else if (!(key in after)) {
        out.push({ op: "-", path: subPath, before: before[key] });
      } else {
        jsonDiff(before[key], after[key], subPath, out);
      }
    }
    return;
  }

  // Primitives or mismatched container types — stringify-equal still equal.
  if (JSON.stringify(before) === JSON.stringify(after)) return;
  out.push({ op: "~", path, before, after });
}

function formatValue(v: unknown): string {
  // Compact one-liner. Truncate long arrays/objects to keep diffs scannable.
  const s = JSON.stringify(v);
  if (s === undefined) return String(v);
  if (s.length <= 200) return s;
  return s.slice(0, 197) + "...";
}

function formatDiff(ops: DiffOp[]): string {
  const lines: string[] = [];
  for (const op of ops) {
    if (op.op === "+") {
      lines.push(`+ ${op.path} = ${formatValue(op.after)}`);
    } else if (op.op === "-") {
      lines.push(`- ${op.path} = ${formatValue(op.before)}`);
    } else {
      lines.push(
        `~ ${op.path}: ${formatValue(op.before)} → ${formatValue(op.after)}`,
      );
    }
  }
  return lines.join("\n");
}

async function cmdDiff(args: string[]) {
  const { v1Path, v2Path } = resolveDiffPaths(args);
  const outPath = readFlag(args, "--out");
  const summaryOnly = hasFlag(args, "--summary");
  const stripKeys = readCsvSetFlag(args, "--stripOutputFields");

  if (!existsSync(v1Path) || !existsSync(v2Path)) {
    console.error(
      `Missing input(s):\n  ${v1Path} ${existsSync(v1Path) ? "✓" : "✗"}\n  ${v2Path} ${existsSync(v2Path) ? "✓" : "✗"}`,
    );
    process.exit(1);
  }

  const v1Raw = loadJson<Record<string, unknown>>(v1Path);
  const v2Raw = loadJson<Record<string, unknown>>(v2Path);
  // Strip from BOTH sides so a stripped key already absent on v1 doesn't
  // surface as a phantom add on v2.
  const v1 = stripKeys.size
    ? (stripFields(v1Raw, stripKeys) as Record<string, unknown>)
    : v1Raw;
  const v2 = stripKeys.size
    ? (stripFields(v2Raw, stripKeys) as Record<string, unknown>)
    : v2Raw;
  const ops: DiffOp[] = [];
  jsonDiff(v1, v2, "", ops);

  // Per-feature summary so the surface area is obvious before reading deltas.
  const featureKeys = new Set<string>([...Object.keys(v1), ...Object.keys(v2)]);
  const opsByFeature = new Map<string, number>();
  for (const op of ops) {
    const head = op.path.split(/[.[]/, 1)[0];
    opsByFeature.set(head, (opsByFeature.get(head) ?? 0) + 1);
  }
  const changedFeatures = [...opsByFeature.keys()].sort();

  console.log(`diff: ${v1Path}`);
  console.log(`   →: ${v2Path}`);
  if (stripKeys.size) {
    console.log(`diff: stripped fields: ${[...stripKeys].sort().join(", ")}`);
  }
  console.log(
    `diff: ${ops.length} delta(s) across ${changedFeatures.length}/${featureKeys.size} feature(s)`,
  );

  if (!summaryOnly) {
    const formatted = formatDiff(ops);
    if (outPath) {
      writeFileSync(outPath, formatted, "utf8");
      console.log(`diff: wrote ${ops.length} line(s) → ${outPath}`);
    } else if (formatted) {
      console.log(formatted);
    }
  } else if (changedFeatures.length) {
    console.log("Top-level entries with deltas (count):");
    for (const key of changedFeatures) {
      console.log(`  ${opsByFeature.get(key)}\t${key}`);
    }
  }
}

async function main() {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);

  if (cmd === "fetch") {
    await cmdFetch(args);
    return;
  }
  if (cmd === "run1") {
    await runApiObj("v1", args);
    return;
  }
  if (cmd === "run2") {
    await runApiObj("v2", args);
    return;
  }
  if (cmd === "diff") {
    await cmdDiff(args);
    return;
  }

  console.error(`Usage:
  tsx src/scripts/diff-features.ts fetch --uri <mongodb-uri>
  tsx src/scripts/diff-features.ts run1 [--in <features.json>] [--orgs <orgs.json>]
                                        [--stripOutputFields <key1,key2,...>]
  tsx src/scripts/diff-features.ts run2 [--in <features.json>] [--orgs <orgs.json>]
                                        [--stripOutputFields <key1,key2,...>]
  tsx src/scripts/diff-features.ts diff [--in <features.json>] [--out <diff.txt>] [--summary]
                                        [--v1 <a.json> --v2 <b.json>]
                                        [--stripOutputFields <key1,key2,...>]

\`--in\` accepts a \`LegacyFeatureInterface[]\` array OR a self-contained
\`{ features: [...], orgs: {...} }\` envelope. Bare arrays auto-discover
\`<stem>_orgs.json\` / \`orgs.json\` siblings. Relative paths resolve against
this script's directory.

Dumps & env: GB_TEST_FEATURES_DATA_DIR (default ~/Downloads/features-diff/)`);
  process.exit(1);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .then(() => {
    process.exit(0);
  });
