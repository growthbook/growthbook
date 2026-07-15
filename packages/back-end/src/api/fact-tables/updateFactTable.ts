import { omit } from "lodash";
import { updateFactTableValidator } from "shared/validators";
import {
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  updateFactTable as updateFactTableInDb,
  updateColumn,
  toFactTableApiInterface,
  getFactTable,
} from "back-end/src/models/FactTableModel";
import { addTagsDiff } from "back-end/src/models/TagModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  resolveOwnerToUserId,
  resolveOwnerEmail,
} from "back-end/src/services/owner";
import { validateAggregatedFactTableSettings } from "back-end/src/util/factTable";

// Type override to handle auto-generated OpenAPI types vs internal types
type UpdateFactTableRequest = Omit<UpdateFactTableProps, "columns"> & {
  columns?: Array<NonNullable<UpdateFactTableProps["columns"]>[0]>;
};

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

  const data: UpdateFactTableProps = { ...req.body } as UpdateFactTableRequest;
  const resolvedOwner = await resolveOwnerToUserId(req.body.owner, req.context);
  if (req.body.owner !== undefined) data.owner = resolvedOwner ?? "";

  // Handle column property updates only (no creation/deletion of columns)
  if (data.columns) {
    // Check if any column has auto slice properties
    const hasAutoSliceProperties = data.columns.some(
      (col) => col.isAutoSliceColumn || col.autoSlices,
    );

    if (hasAutoSliceProperties) {
      // Check enterprise feature access
      if (!req.context.hasPremiumFeature("metric-slices")) {
        throw new Error("Metric slices require an enterprise license");
      }
    }

    // Only allow updating properties of existing columns
    for (const columnUpdate of data.columns) {
      const existingColumn = factTable.columns.find(
        (c) => c.column === columnUpdate.column,
      );
      if (!existingColumn) {
        throw new Error(
          `Column ${columnUpdate.column} not found - cannot create new columns via API`,
        );
      }

      await updateColumn({
        context: req.context,
        factTable,
        column: columnUpdate.column,
        // Strip server/UI-managed fields: the API cannot change a column's
        // origin (isVirtual) or a virtual column's expression (sql).
        changes: omit(columnUpdate, [
          "dateCreated",
          "dateUpdated",
          "isVirtual",
          "sql",
        ]),
      });
    }

    // Remove columns from the main update since we handled them individually
    delete data.columns;
  }

  await updateFactTableInDb(req.context, factTable, data);
  if (needsColumnRefresh(factTable, data)) {
    await queueFactTableColumnsRefresh(factTable);
  }

  if (data.tags) {
    await addTagsDiff(req.organization.id, factTable.tags, data.tags);
  }

  const updatedFactTable = {
    ...factTable,
    ...req.body,
    columns: req.body.columns
      ? (
          req.body.columns as NonNullable<UpdateFactTableRequest["columns"]>
        ).map((col) => ({
          ...omit(col, ["isVirtual", "sql"]),
          name: col.name ?? col.column,
          description: col.description ?? "",
          numberFormat: col.numberFormat ?? "",
          dateCreated:
            factTable.columns.find((c) => c.column === col.column)
              ?.dateCreated || new Date(),
          dateUpdated: new Date(),
          deleted: false,
        }))
      : factTable.columns,
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
