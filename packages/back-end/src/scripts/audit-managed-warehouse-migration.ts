// We need to import the aliases here to make the imports work.
// eslint-disable-next-line no-restricted-imports
import "../init/aliases";
// Load .env.local before any module reads process.env (e.g. CLOUD_SECRET in secrets.ts).
// eslint-disable-next-line no-restricted-imports
import "../init/dotenv";
import {
  MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES,
  getManagedWarehouseUserIdTypes,
} from "shared/util";
import {
  DataSourceInterface,
  GrowthbookClickhouseDataSource,
  MaterializedColumn,
} from "shared/types/datasource";
import { ColumnRef, FactMetricInterface } from "shared/types/fact-table";
import { _dangerousGetAllDatasources } from "back-end/src/models/DataSourceModel";
import { getFactTablesForDatasource } from "back-end/src/models/FactTableModel";
import { init } from "back-end/src/init";
import { getContextForAgendaJobByOrgId } from "back-end/src/services/organizations";
import { buildMaterializedColumnRewriteMap } from "back-end/src/util/migrateManagedWarehouseColumns";

// Read-only discovery pass for the legacy managed-warehouse -> JSON-columns migration.
// Reports every warehouse still on materialized columns and flags anything that needs
// manual attention before (or instead of) an automated migration.

function isLegacyManagedWarehouse(
  ds: DataSourceInterface,
): ds is GrowthbookClickhouseDataSource {
  return ds.type === "growthbook_clickhouse" && !ds.settings.useJsonColumns;
}

function columnRefReferences(ref: ColumnRef, names: Set<string>): boolean {
  if (names.has(ref.column)) return true;
  if (ref.aggregateFilterColumn && names.has(ref.aggregateFilterColumn)) {
    return true;
  }
  return (ref.rowFilters || []).some(
    (rf) => rf.column !== undefined && names.has(rf.column),
  );
}

function metricReferences(
  metric: Pick<FactMetricInterface, "numerator" | "denominator">,
  names: Set<string>,
): boolean {
  if (columnRefReferences(metric.numerator, names)) return true;
  return metric.denominator
    ? columnRefReferences(metric.denominator, names)
    : false;
}

async function run() {
  await init();

  const allDatasources = await _dangerousGetAllDatasources();
  const legacy = allDatasources.filter(isLegacyManagedWarehouse);

  console.log(
    `Found ${legacy.length} legacy (materialized-column) managed warehouse(s) out of ${allDatasources.length} total datasources.\n`,
  );

  let flaggedCount = 0;

  for (const ds of legacy) {
    const context = await getContextForAgendaJobByOrgId(ds.organization);
    const attributeSchema = context.org.settings?.attributeSchema;
    const matCols: MaterializedColumn[] = ds.settings.materializedColumns || [];

    const identifiers = matCols.filter((c) => c.type === "identifier");
    const dimensions = matCols.filter((c) => c.type === "dimension");
    const other = matCols.filter((c) => !c.type);

    // Columns that won't survive as real top-level columns -> queryable as attributes.<sourceField>
    const rewriteMap = buildMaterializedColumnRewriteMap(
      matCols,
      MANAGED_WAREHOUSE_RESERVED_COLUMN_NAMES,
    );
    const rewritable = new Set(Object.keys(rewriteMap));

    // Identifiers whose userIdType would change when re-derived from hashAttributes.
    const newUserIdTypes = new Set(
      getManagedWarehouseUserIdTypes(attributeSchema),
    );
    const renamingIdentifiers = identifiers.filter(
      (c) => !newUserIdTypes.has(c.columnName),
    );

    // Fact metrics on this datasource that reference a to-be-dropped column.
    const factMetrics = await context.models.factMetrics.getAllSorted({
      datasourceId: ds.id,
    });
    const dependentMetrics = factMetrics.filter((m) =>
      metricReferences(m, rewritable),
    );

    // Exposure dimensions that reference a to-be-dropped column.
    const dependentDimensions = (ds.settings.queries?.exposure || []).flatMap(
      (q) =>
        (q.dimensions || [])
          .filter((d) => rewritable.has(d))
          .map((d) => `${q.userIdType}:${d}`),
    );

    // Fact filters whose raw SQL references a to-be-dropped column (textual; can't auto-rewrite).
    const factTables = await getFactTablesForDatasource(context, ds.id);
    const dependentFilters: string[] = [];
    for (const ft of factTables) {
      for (const filter of ft.filters || []) {
        const hit = [...rewritable].find((name) =>
          new RegExp(`\\b${name}\\b`).test(filter.value),
        );
        if (hit) dependentFilters.push(`${ft.id}/${filter.id} (${hit})`);
      }
    }

    const flags: string[] = [];
    if (!ds.settings.hasBeenProvisioned) flags.push("NOT PROVISIONED");
    if (renamingIdentifiers.length) {
      flags.push(
        `userIdType change: ${renamingIdentifiers.map((c) => c.columnName).join(", ")}`,
      );
    }
    if (dependentMetrics.length) {
      flags.push(`${dependentMetrics.length} dependent fact metric(s)`);
    }
    if (dependentDimensions.length) {
      flags.push(
        `${dependentDimensions.length} dependent exposure dimension(s): ${dependentDimensions.join(", ")}`,
      );
    }
    if (dependentFilters.length) {
      flags.push(
        `${dependentFilters.length} fact filter(s) referencing dropped columns (manual): ${dependentFilters.join(", ")}`,
      );
    }
    if (flags.length) flaggedCount++;

    console.log(`- ${ds.name} (${ds.id}) org=${ds.organization}`);
    console.log(
      `    materialized columns: ${identifiers.length} identifier, ${dimensions.length} dimension, ${other.length} other`,
    );
    console.log(
      `    will rewrite ${rewritable.size} column(s) to attributes.<sourceField>: ${
        [...rewritable].join(", ") || "(none)"
      }`,
    );
    console.log(`    flags: ${flags.length ? flags.join("; ") : "none"}`);
  }

  console.log(
    `\nSummary: ${legacy.length} legacy warehouse(s), ${flaggedCount} need manual review.`,
  );
}

run()
  .then(() => {
    console.log("Done!");
  })
  .catch((e) => {
    console.error(e);
  })
  .finally(() => {
    process.exit(0);
  });
