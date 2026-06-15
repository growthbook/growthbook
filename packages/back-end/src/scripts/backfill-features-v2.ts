// One-time disk backfill of legacy (v0/v1) feature documents to the v2
// shape, including the denormalized `prerequisiteIds` stamp and the per-org
// `migrations.featuresV2` marker that unlocks the index-backed dependents
// query. Idempotent and resumable; safe to run while the app is serving
// traffic (concurrent user saves win via an optimistic dateUpdated guard).
//
// Usage:
//   yarn ts-node src/scripts/backfill-features-v2.ts [--dry-run] [--org <orgId>]... [--write-interval-ms <n>]

// We need to import the aliases here to make the imports work.
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
import { init } from "back-end/src/init";
import { backfillFeaturesV2 } from "back-end/src/services/featuresV2Backfill";

function parseArgs(argv: string[]) {
  const orgIds: string[] = [];
  let dryRun = false;
  let writeIntervalMs = 0;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--org") {
      const value = argv[++i];
      if (!value) throw new Error("--org requires a value");
      orgIds.push(value);
    } else if (arg === "--write-interval-ms") {
      const value = parseInt(argv[++i], 10);
      if (isNaN(value) || value < 0) {
        throw new Error("--write-interval-ms requires a non-negative number");
      }
      writeIntervalMs = value;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return { orgIds, dryRun, writeIntervalMs };
}

async function run() {
  const { orgIds, dryRun, writeIntervalMs } = parseArgs(process.argv.slice(2));

  // Initialize the mongo connection, etc.
  await init();

  console.log(
    `Starting features v2 backfill${dryRun ? " (dry run)" : ""}${
      orgIds.length ? ` for orgs: ${orgIds.join(", ")}` : " for all orgs"
    }`,
  );

  const allStats = await backfillFeaturesV2({
    orgIds,
    dryRun,
    writeIntervalMs,
  });

  const totals = allStats.reduce(
    (acc, s) => ({
      orgs: acc.orgs + 1,
      scanned: acc.scanned + s.scanned,
      conforming: acc.conforming + s.conforming,
      rewritten: acc.rewritten + s.rewritten,
      skippedInvariant: acc.skippedInvariant + s.skippedInvariant,
      skippedConflict: acc.skippedConflict + s.skippedConflict,
      errors: acc.errors + s.errors,
      markedOrgs: acc.markedOrgs + (s.markedOrg ? 1 : 0),
    }),
    {
      orgs: 0,
      scanned: 0,
      conforming: 0,
      rewritten: 0,
      skippedInvariant: 0,
      skippedConflict: 0,
      errors: 0,
      markedOrgs: 0,
    },
  );

  console.log("Backfill summary:", JSON.stringify(totals, null, 2));

  const problems = allStats.filter(
    (s) => s.skippedInvariant > 0 || s.errors > 0,
  );
  if (problems.length) {
    console.log(
      "Orgs with skipped docs or errors (NOT marked, will stay on full-scan path):",
    );
    for (const s of problems) {
      console.log(`  ${s.orgId}:`, JSON.stringify(s));
    }
  }
}

run()
  .then(() => {
    console.log("Done!");
  })
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit();
  });
