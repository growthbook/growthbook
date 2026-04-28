/**
 * Production feature migration / API-shape comparison tool.
 *
 *   1) fetch  — Per month: find() matching dateCreated, sort, limit 20; then fetch orgs; write snapshot.
 *   2) run1   — On main: toInterface(FeatureModel) then getApiFeatureObj → v1.json (keys sorted for diffs)
 *   3) run2   — On this branch: toInterface(FeatureModel) then getApiFeatureObj → v2.json (keys sorted)
 *
 * Data files (PII): set GB_TEST_FEATURES_DATA_DIR to an absolute path outside the repo
 * (optional leading `~/` is expanded). Defaults to ~/Downloads/. Never commit dumps.
 *
 * Usage (from packages/back-end):
 *   pnpm exec tsx src/scripts/test-features.ts fetch --uri "mongodb://..."
 *   pnpm exec tsx src/scripts/test-features.ts run1
 *   pnpm exec tsx src/scripts/test-features.ts run2
 */

import { writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
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

function readUriFlag(args: string[]): string | undefined {
  const i = args.indexOf("--uri");
  if (i !== -1 && typeof args[i + 1] === "string") {
    return args[i + 1];
  }
  return undefined;
}

async function cmdFetch(args: string[]) {
  const uri = readUriFlag(args);
  if (!uri) {
    console.error(
      "Usage: tsx src/scripts/test-features.ts fetch --uri <mongodb connection string>",
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

async function cmdRun1() {
  await import("../init/aliases");
  const paths = getTestFeaturesDumpPaths();
  console.log(`run1: dump directory ${paths.dir}`);
  const { FeatureModel, toInterface } = await import("../models/FeatureModel");
  const { getApiFeatureObj } = await import("../services/features");

  if (!existsSync(paths.featuresJson) || !existsSync(paths.orgsJson)) {
    console.error(
      `Missing snapshot. Run fetch first (expected ${paths.featuresJson} and ${paths.orgsJson}).`,
    );
    process.exit(1);
  }

  type Legacy = import("shared/types/feature").LegacyFeatureInterface;
  type Org = import("shared/types/organization").OrganizationInterface;

  const features = loadJson<Legacy[]>(paths.featuresJson);
  const orgById = loadJson<Record<string, Org>>(paths.orgsJson);

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
      const doc = new FeatureModel(raw);
      const feature = toInterface(doc, context);
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

  writeFileSync(
    paths.v1Json,
    JSON.stringify(sortKeysDeep(out), null, 2),
    "utf8",
  );
  console.log(
    `run1: wrote ${ok} ok, ${fail} failed → ${paths.v1Json} (${features.length} input features)`,
  );
}

async function cmdRun2() {
  await import("../init/aliases");
  const paths = getTestFeaturesDumpPaths();
  console.log(`run2: dump directory ${paths.dir}`);
  const FM = await import("../models/FeatureModel");
  const { FeatureModel, toInterface } = FM;

  const { getApiFeatureObj } = await import("../services/features");

  if (!existsSync(paths.featuresJson) || !existsSync(paths.orgsJson)) {
    console.error(
      `Missing snapshot. Run fetch first (expected ${paths.featuresJson} and ${paths.orgsJson}).`,
    );
    process.exit(1);
  }

  type Legacy = import("shared/types/feature").LegacyFeatureInterface;
  type Org = import("shared/types/organization").OrganizationInterface;

  const features = loadJson<Legacy[]>(paths.featuresJson);
  const orgById = loadJson<Record<string, Org>>(paths.orgsJson);

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

  writeFileSync(
    paths.v2Json,
    JSON.stringify(sortKeysDeep(out), null, 2),
    "utf8",
  );
  console.log(
    `run2: wrote ${ok} ok, ${fail} failed → ${paths.v2Json} (${features.length} input features)`,
  );
}

async function main() {
  const cmd = process.argv[2];

  if (cmd === "fetch") {
    await cmdFetch(process.argv.slice(3));
    return;
  }
  if (cmd === "run1") {
    await cmdRun1();
    return;
  }
  if (cmd === "run2") {
    await cmdRun2();
    return;
  }

  console.error(`Usage:
  tsx src/scripts/test-features.ts fetch --uri <mongodb-uri>
  tsx src/scripts/test-features.ts run1
  tsx src/scripts/test-features.ts run2

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
