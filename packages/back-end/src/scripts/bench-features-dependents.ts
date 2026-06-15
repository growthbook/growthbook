// Local before/after benchmark for the features v2 backfill + indexed
// dependents query. Seeds a synthetic org with v1-shaped (legacy) feature
// docs, measures the full-scan dependents path, runs the backfill, then
// measures the indexed path and asserts result parity.
//
// Usage (requires a running MongoDB, e.g. the standard dev container):
//   yarn ts-node src/scripts/bench-features-dependents.ts \
//     [--features 20000] [--targets 5] [--dependents-per-target 10] \
//     [--iterations 5] [--keep]

// We need to import the aliases here to make the imports work.
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
import { performance } from "perf_hooks";
import mongoose from "mongoose";
import { getDependentFeatures } from "shared/util";
import { init } from "back-end/src/init";
import {
  FeatureModel,
  getAllFeatures,
  getFeaturesByIds,
  getFeaturesUsingPrerequisites,
} from "back-end/src/models/FeatureModel";
import { backfillFeaturesV2ForOrg } from "back-end/src/services/featuresV2Backfill";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { buildFeatureLookups } from "back-end/src/util/features";
import { getCollection } from "back-end/src/util/mongo.util";

const ORG_ID = "org_bench_featv2";

function parseArgs(argv: string[]) {
  const opts = {
    features: 20000,
    targets: 5,
    dependentsPerTarget: 10,
    iterations: 5,
    keep: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--features") opts.features = parseInt(argv[++i], 10);
    else if (arg === "--targets") opts.targets = parseInt(argv[++i], 10);
    else if (arg === "--dependents-per-target")
      opts.dependentsPerTarget = parseInt(argv[++i], 10);
    else if (arg === "--iterations") opts.iterations = parseInt(argv[++i], 10);
    else if (arg === "--keep") opts.keep = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return opts;
}

// v1-shaped legacy doc: rules live under environmentSettings.<env>.rules and
// carry no allEnvironments/environments markers, no prerequisiteIds stamp.
function makeV1FeatureDoc(
  i: number,
  prereqTargetId: string | null,
): Record<string, unknown> {
  const now = new Date();
  const rule = {
    type: "force",
    id: `fr_bench_${i}`,
    value: "true",
    enabled: true,
    description: "",
    condition: `{"country": "us-${i % 50}"}`,
    ...(prereqTargetId
      ? {
          prerequisites: [{ id: prereqTargetId, condition: `{"value": true}` }],
        }
      : {}),
  };
  return {
    id: `bench_feature_${i}`,
    organization: ORG_ID,
    project: "",
    archived: i % 25 === 0,
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    dateCreated: now,
    dateUpdated: now,
    owner: "bench",
    description: `Benchmark feature ${i}`,
    tags: [],
    environmentSettings: {
      production: { enabled: true, rules: [rule] },
      dev: { enabled: true, rules: [rule] },
    },
  };
}

async function seed(opts: ReturnType<typeof parseArgs>): Promise<string[]> {
  // Minimal org doc WITHOUT the migrations.featuresV2 marker so the org
  // starts on the full-scan path, like any real pre-backfill org.
  await getCollection("organizations").deleteMany({ id: ORG_ID });
  await getCollection("organizations").insertOne({
    id: ORG_ID,
    name: "Features v2 Benchmark Org",
    ownerEmail: "bench@example.com",
    url: "",
    dateCreated: new Date(),
    members: [],
    invites: [],
    settings: {
      environments: [
        { id: "production", description: "" },
        { id: "dev", description: "" },
      ],
    },
  });

  await FeatureModel.collection.deleteMany({ organization: ORG_ID });

  const targetIds = Array.from(
    { length: opts.targets },
    (_, t) => `bench_feature_${t}`,
  );

  // Targets are the first docs; their dependents are spread evenly across
  // the corpus so the indexed query has to find them among the noise.
  const dependentIndexes = new Map<number, string>();
  const stride = Math.floor(
    opts.features / (opts.targets * opts.dependentsPerTarget + 1),
  );
  let slot = opts.targets;
  for (const targetId of targetIds) {
    for (let d = 0; d < opts.dependentsPerTarget; d++) {
      slot += Math.max(stride, 1);
      if (slot >= opts.features) break;
      dependentIndexes.set(slot, targetId);
    }
  }

  const BATCH = 1000;
  let batch: Record<string, unknown>[] = [];
  for (let i = 0; i < opts.features; i++) {
    batch.push(makeV1FeatureDoc(i, dependentIndexes.get(i) ?? null));
    if (batch.length >= BATCH) {
      await FeatureModel.collection.insertMany(batch, { ordered: false });
      batch = [];
    }
  }
  if (batch.length) {
    await FeatureModel.collection.insertMany(batch, { ordered: false });
  }
  await FeatureModel.ensureIndexes();

  console.log(
    `Seeded ${opts.features} v1-shaped features (${dependentIndexes.size} dependents across ${opts.targets} targets)`,
  );
  return targetIds;
}

type Measurement = {
  label: string;
  medianMs: number;
  minMs: number;
  featuresLoaded: number;
  docsExamined: number;
  planStage: string;
  dependents: Record<string, string[]>;
};

async function explain(
  filter: Record<string, unknown>,
): Promise<{ docsExamined: number; stage: string }> {
  const db = mongoose.connection.db;
  const res = await db.command({
    explain: { find: "features", filter },
    verbosity: "executionStats",
  });
  const stats = res.executionStats;
  const winning = JSON.stringify(res.queryPlanner?.winningPlan ?? {});
  const stage = winning.includes("IXSCAN") ? "IXSCAN" : "COLLSCAN";
  return { docsExamined: stats?.totalDocsExamined ?? -1, stage };
}

async function measure(
  label: string,
  targetIds: string[],
  iterations: number,
  useIndexedPath: boolean,
): Promise<Measurement> {
  const context = await getContextForAgendaJobByOrgId(ORG_ID);
  const allEnvIds = ["production", "dev"];

  const durations: number[] = [];
  let featuresLoaded = 0;
  let dependents: Record<string, string[]> = {};

  for (let iter = 0; iter < iterations; iter++) {
    const start = performance.now();

    let targets, candidates;
    if (useIndexedPath) {
      [targets, candidates] = await Promise.all([
        getFeaturesByIds(context, targetIds),
        getFeaturesUsingPrerequisites(context, targetIds),
      ]);
    } else {
      const all = await getAllFeatures(context, { includeArchived: true });
      targets = all;
      candidates = all;
    }

    const { featuresMap, reverseDependencyIndex } =
      buildFeatureLookups(candidates);
    const targetsMap = useIndexedPath
      ? new Map(targets.map((f) => [f.id, f]))
      : featuresMap;

    dependents = {};
    for (const id of targetIds) {
      const feature = targetsMap.get(id);
      dependents[id] = feature
        ? getDependentFeatures(
            feature,
            candidates,
            allEnvIds,
            reverseDependencyIndex,
            featuresMap,
          ).sort()
        : [];
    }

    durations.push(performance.now() - start);
    featuresLoaded = candidates.length + (useIndexedPath ? targets.length : 0);
  }

  const filter = useIndexedPath
    ? { organization: ORG_ID, prerequisiteIds: { $in: targetIds } }
    : { organization: ORG_ID };
  const { docsExamined, stage } = await explain(filter);

  durations.sort((a, b) => a - b);
  return {
    label,
    medianMs: Math.round(durations[Math.floor(durations.length / 2)] * 10) / 10,
    minMs: Math.round(durations[0] * 10) / 10,
    featuresLoaded,
    docsExamined,
    planStage: stage,
    dependents,
  };
}

async function run() {
  const opts = parseArgs(process.argv.slice(2));
  await init();

  const targetIds = await seed(opts);

  console.log("\n--- BEFORE backfill (full-scan path) ---");
  const before = await measure("full_scan", targetIds, opts.iterations, false);
  console.log(before);

  console.log("\n--- Running backfill ---");
  const backfillStart = performance.now();
  const stats = await backfillFeaturesV2ForOrg(ORG_ID);
  console.log({
    ...stats,
    backfillMs: Math.round(performance.now() - backfillStart),
  });
  if (!stats.markedOrg) {
    throw new Error("Backfill did not mark the org — aborting benchmark");
  }
  const unstamped = await FeatureModel.collection.countDocuments({
    organization: ORG_ID,
    prerequisiteIds: { $exists: false },
  });
  console.log(`Docs missing prerequisiteIds after backfill: ${unstamped}`);

  console.log("\n--- AFTER backfill (indexed path) ---");
  const after = await measure("indexed", targetIds, opts.iterations, true);
  console.log(after);

  // Re-measure the full-scan path post-backfill to isolate the JIT savings
  // (same corpus size, but no flattenV1ToV2Rules work per doc).
  console.log(
    "\n--- AFTER backfill (full-scan path, isolates JIT savings) ---",
  );
  const afterFullScan = await measure(
    "full_scan_post_backfill",
    targetIds,
    opts.iterations,
    false,
  );
  console.log(afterFullScan);

  // Parity: identical dependents before and after.
  const parity =
    JSON.stringify(before.dependents) === JSON.stringify(after.dependents);
  console.log(
    `\nResult parity (before vs indexed): ${parity ? "OK" : "MISMATCH"}`,
  );
  if (!parity) {
    console.log("before:", before.dependents);
    console.log("after:", after.dependents);
  }

  console.log("\n=== Summary ===");
  for (const m of [before, afterFullScan, after]) {
    console.log(
      `${m.label.padEnd(25)} median=${m.medianMs}ms min=${m.minMs}ms ` +
        `featuresLoaded=${m.featuresLoaded} docsExamined=${m.docsExamined} plan=${m.planStage}`,
    );
  }

  if (!opts.keep) {
    await FeatureModel.collection.deleteMany({ organization: ORG_ID });
    await getCollection("organizations").deleteMany({ id: ORG_ID });
    await getCollection("features_v2_backfill_backups").deleteMany({
      "doc.organization": ORG_ID,
    });
    console.log("\nCleaned up benchmark data (use --keep to retain)");
  }

  if (!parity) process.exitCode = 1;
}

run()
  .then(() => console.log("Done!"))
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => process.exit());
