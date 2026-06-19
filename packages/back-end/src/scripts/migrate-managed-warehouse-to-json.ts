// We need to import the aliases here to make the imports work.
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
// Load .env.local before any module reads process.env (e.g. CLOUD_SECRET in secrets.ts).
// eslint-disable-next-line no-restricted-imports
import "../init/dotenv";
import { MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES } from "shared/util";
import {
  DataSourceInterface,
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import {
  _dangerousGetAllDatasources,
  getDataSourceById,
  updateDataSource,
} from "back-end/src/models/DataSourceModel";
import { init } from "back-end/src/init";
import { ApiReqContext } from "back-end/types/api";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { syncManagedWarehouseIdentifiers } from "back-end/src/services/clickhouse";
import { dangerousRecreateClickhouseTables } from "back-end/src/services/licenseServerManagedClickhouse";
import {
  buildMaterializedColumnRewriteMap,
  rewriteFactMetricColumns,
} from "back-end/src/util/migrateManagedWarehouseColumns";

// Migrate legacy (materialized-column) managed warehouses to native JSON columns.
// Idempotent + resumable: a warehouse is "done" once useJsonColumns is set and its
// materializedColumns are cleared. Pass --dry-run to report without mutating anything.

const DRY_RUN = process.argv.slice(2).includes("--dry-run");

function isLegacyManagedWarehouse(
  ds: DataSourceInterface,
): ds is GrowthbookClickhouseDataSource {
  return (
    ds.type === "growthbook_clickhouse" &&
    !(ds.settings.useJsonColumns && !ds.settings.materializedColumns?.length)
  );
}

async function rewriteFactMetrics(
  context: ApiReqContext,
  datasourceId: string,
  rewriteMap: Record<string, string>,
): Promise<{ rewritten: number; failed: string[] }> {
  if (!Object.keys(rewriteMap).length) return { rewritten: 0, failed: [] };

  const factMetrics = await context.models.factMetrics.getAllSorted({
    datasourceId,
  });

  let rewritten = 0;
  const failed: string[] = [];
  for (const metric of factMetrics) {
    const updates = rewriteFactMetricColumns(metric, rewriteMap);
    if (!updates) continue;
    if (DRY_RUN) {
      rewritten++;
      continue;
    }
    // A single un-updatable metric (e.g. an aggregation no longer valid on the
    // rewritten column) must not abort the whole warehouse migration — log it for
    // manual fixup and keep going so the warehouse still finishes.
    try {
      await context.models.factMetrics.update(metric, updates);
      rewritten++;
    } catch (e) {
      failed.push(metric.id);
      console.error(`      metric ${metric.id} could not be rewritten:`, e);
    }
  }
  return { rewritten, failed };
}

// Returns the number of metrics that need manual fixup (0 on a fully-clean run).
async function migrateWarehouse(
  ds: GrowthbookClickhouseDataSource,
): Promise<number> {
  const context = await getContextForAgendaJobByOrgId(ds.organization);
  const attributeSchema = context.org.settings?.attributeSchema;
  const matCols: MaterializedColumn[] = ds.settings.materializedColumns || [];
  const rewriteMap = buildMaterializedColumnRewriteMap(
    matCols,
    MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES,
  );

  console.log(`- Migrating '${ds.name}' (${ds.id}) org=${ds.organization}`);
  console.log(
    `    ${matCols.length} materialized column(s); rewriting refs for: ${
      Object.keys(rewriteMap).join(", ") || "(none)"
    }`,
  );

  if (DRY_RUN) {
    const { rewritten } = await rewriteFactMetrics(context, ds.id, rewriteMap);
    console.log(
      `    [dry-run] would flip useJsonColumns, recreate tables, re-sync identifiers, rewrite ${rewritten} metric(s), and clear materializedColumns`,
    );
    return 0;
  }

  // 1. Flip the flag (keep materializedColumns so a crash before the final clear
  //    leaves this warehouse re-runnable). The license server reads useJsonColumns
  //    straight from this collection, so the next recreate uses the JSON path.
  await updateDataSource(context, ds, {
    settings: { ...ds.settings, useJsonColumns: true },
  });

  // 2. Recreate the per-org ClickHouse tables as JSON and repopulate from enriched_events.
  await dangerousRecreateClickhouseTables(ds.organization);

  // 3. Regenerate the ch_events fact table + datasource userIdTypes/exposure queries.
  await syncManagedWarehouseIdentifiers(context, attributeSchema);

  // 4. Rewrite metric refs that pointed at dropped materialized columns (before
  //    clearing, so a crash here still leaves the mapping intact for a re-run).
  const { rewritten, failed } = await rewriteFactMetrics(
    context,
    ds.id,
    rewriteMap,
  );

  // 5. Clear materializedColumns (re-fetch: sync mutated the datasource settings).
  const updated = await getDataSourceById(context, ds.id);
  if (updated && updated.type === "growthbook_clickhouse") {
    await updateDataSource(context, updated, {
      settings: { ...updated.settings, materializedColumns: undefined },
    });
  }

  console.log(
    `    done (rewrote ${rewritten} metric(s)${
      failed.length
        ? `, ${failed.length} need manual fixup: ${failed.join(", ")}`
        : ""
    }).`,
  );
  return failed.length;
}

// Resolves to the number of warehouses that didn't migrate fully cleanly (a hard
// per-warehouse failure or any metric left needing manual fixup), so the caller
// can exit non-zero for CI/automation.
async function run(): Promise<number> {
  await init();

  const allDatasources = await _dangerousGetAllDatasources();
  const legacy = allDatasources.filter(isLegacyManagedWarehouse);

  console.log(
    `${DRY_RUN ? "[dry-run] " : ""}Found ${legacy.length} legacy managed warehouse(s) to migrate.\n`,
  );

  let incomplete = 0;
  for (const ds of legacy) {
    try {
      if ((await migrateWarehouse(ds)) > 0) incomplete++;
    } catch (e) {
      incomplete++;
      console.error(`  Failed to migrate '${ds.name}' (${ds.id}):`, e);
    }
  }
  return incomplete;
}

run()
  .then((incomplete) => {
    console.log("\nDone!");
    // Non-zero when any warehouse failed or left metrics needing manual fixup.
    process.exit(incomplete > 0 ? 1 : 0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
