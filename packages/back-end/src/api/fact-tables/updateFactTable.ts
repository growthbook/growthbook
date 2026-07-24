import { omit } from "lodash";
import { updateFactTableValidator } from "shared/validators";
import {
  ColumnInterface,
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  updateFactTable as updateFactTableInDb,
  upsertColumns,
  toFactTableApiInterface,
  getFactTable,
} from "back-end/src/models/FactTableModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerToUserId,
  resolveOwnerEmail,
} from "back-end/src/services/owner";
import {
  columnsHaveAutoSlices,
  validateAggregatedFactTableSettings,
} from "back-end/src/util/factTable";

export const updateFactTable = createApiRequestHandler(
  updateFactTableValidator,
)(async (req) => {
  const factTable = await getFactTable(req.context, req.params.id);
  if (!factTable) {
    throw new Error("Could not find factTable with that id");
  }

  // Validate projects
  if (req.body.projects?.length) {
    const projects = await req.context.models.projects.getAll();
    const projectIds = new Set(projects.map((p) => p.id));
    for (const projectId of req.body.projects) {
      if (!projectIds.has(projectId)) {
        throw new Error(`Project ${projectId} not found`);
      }
    }
  }

  let datasource: Awaited<ReturnType<typeof getDataSourceById>> | undefined;

  // Validate userIdTypes
  if (req.body.userIdTypes) {
    datasource ??= await getDataSourceById(req.context, factTable.datasource);
    if (!datasource) {
      throw new Error("Could not find datasource for this fact table");
    }
    for (const userIdType of req.body.userIdTypes) {
      if (
        !datasource.settings?.userIdTypes?.some(
          (t) => t.userIdType === userIdType,
        )
      ) {
        throw new Error(`Invalid userIdType: ${userIdType}`);
      }
    }
  }

  if (req.body.aggregatedFactTableSettings) {
    if (!req.context.hasPremiumFeature("pipeline-mode")) {
      throw new Error(
        "Maintaining shared daily aggregated tables requires the data pipeline feature.",
      );
    }
    datasource ??= await getDataSourceById(req.context, factTable.datasource);
    if (!datasource) {
      throw new Error("Could not find datasource for this fact table");
    }
    if (!req.context.permissions.canUpdateDataSourceSettings(datasource)) {
      req.context.permissions.throwPermissionError();
    }
    validateAggregatedFactTableSettings(
      req.body.aggregatedFactTableSettings,
      req.body.userIdTypes ?? factTable.userIdTypes,
    );
  }

  if (
    columnsHaveAutoSlices(req.body.columns) &&
    !req.context.hasPremiumFeature("metric-slices")
  ) {
    throw new Error("Metric slices require an enterprise license");
  }

  const data: UpdateFactTableProps = { ...req.body };
  const resolvedOwner = await resolveOwnerToUserId(req.body.owner, req.context);
  if (req.body.owner !== undefined) data.owner = resolvedOwner ?? "";

  let columnsUpserted = false;
  if (data.columns) {
    await upsertColumns({
      context: req.context,
      factTable,
      // Strip server/UI-managed fields: the API cannot change a column's
      // origin (isVirtual) or a virtual column's expression (sql).
      columns: data.columns.map((col) => omit(col, ["isVirtual", "sql"])),
    });
    columnsUpserted = true;
    delete data.columns;
  }

  await updateFactTableInDb(req.context, factTable, data);
  if (
    needsColumnRefresh(factTable, data) ||
    (columnsUpserted && columnsNeedDetection(factTable.columns))
  ) {
    await queueFactTableColumnsRefresh(factTable);
  }

  if (data.tags) {
    await addTagsDiff(req.organization.id, factTable.tags, data.tags);
  }

  const updatedFactTable = {
    ...factTable,
    ...req.body,
    columns: factTable.columns,
  };
  return {
    factTable: await resolveOwnerEmail(
      toFactTableApiInterface(updatedFactTable),
      req.context,
    ),
  };
});

export function needsColumnRefresh(
  existing: Pick<FactTableInterface, "sql" | "eventName">,
  changes: UpdateFactTableProps,
): boolean {
  const sqlChanged = changes.sql !== undefined && changes.sql !== existing.sql;
  const eventNameChanged =
    changes.eventName !== undefined && changes.eventName !== existing.eventName;
  return sqlChanged || eventNameChanged;
}

export function columnsNeedDetection(columns?: ColumnInterface[]): boolean {
  return (columns ?? []).some((c) => c.datatype === "");
}
