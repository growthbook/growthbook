import { omit } from "lodash";
import { UpdateFactTableProps } from "back-end/types/fact-table";
import { UpdateFactTableResponse } from "back-end/types/openapi";
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
import { updateFactTableValidator } from "back-end/src/validators/openapi";

// Type override to handle auto-generated OpenAPI types vs internal types
type UpdateFactTableRequest = Omit<UpdateFactTableProps, "columns"> & {
  columns?: Array<NonNullable<UpdateFactTableProps["columns"]>[0]>;
};

export const updateFactTable = createApiRequestHandler(
  updateFactTableValidator,
)(async (req): Promise<UpdateFactTableResponse> => {
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

  // Validate userIdTypes
  if (req.body.userIdTypes) {
    const datasource = await getDataSourceById(
      req.context,
      factTable.datasource,
    );
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

  const data: UpdateFactTableProps = { ...req.body } as UpdateFactTableRequest;

  // Handle column property updates only (no creation/deletion of columns)
  if (data.columns) {
    // Check if any column has dimension properties
    const hasDimensionProperties = data.columns.some(
      (col) => col.isDimension || col.dimensionLevels,
    );

    if (hasDimensionProperties) {
      // Check enterprise feature access
      if (!req.context.hasPremiumFeature("metric-dimensions")) {
        throw new Error("Metric dimensions require an enterprise license");
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

      await updateColumn(
        factTable,
        columnUpdate.column,
        omit(columnUpdate, ["dateCreated", "dateUpdated"]),
      );
    }

    // Remove columns from the main update since we handled them individually
    delete data.columns;
  }

  await updateFactTableInDb(req.context, factTable, data);
  if (needsColumnRefresh(data)) {
    await queueFactTableColumnsRefresh(factTable);
  }

  if (data.tags) {
    await addTagsDiff(req.organization.id, factTable.tags, data.tags);
  }

  return {
    factTable: toFactTableApiInterface({
      ...factTable,
      ...req.body,
      columns: req.body.columns
        ? (
            req.body.columns as NonNullable<UpdateFactTableRequest["columns"]>
          ).map((col) => ({
            ...col,
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
    }),
  };
});

export function needsColumnRefresh(changes: UpdateFactTableProps): boolean {
  return !!(changes.sql || changes.eventName);
}
