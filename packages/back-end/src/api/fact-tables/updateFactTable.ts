import { updateFactTableValidator } from "shared/validators";
import {
  FactTableInterface,
  UpdateFactTableProps,
} from "shared/types/fact-table";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  updateFactTable as updateFactTableInDb,
  mergeUpsertColumns,
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
  columnsNeedDetection,
  validateAggregatedFactTableSettings,
  validateVirtualColumnProps,
  validateVirtualColumnSql,
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

  const incomingColumns = data.columns;
  let columnRefreshWillBeNeeded = false;
  if (incomingColumns) {
    let touchesVirtualColumn = false;
    for (const col of incomingColumns) {
      const existingCol = factTable.columns.find(
        (c) => c.column === col.column,
      );

      // Origin is immutable: a SQL-detected column can never become virtual and
      // a virtual column can never stop being one. `mergeUpsertColumns` pins
      // `isVirtual` to the existing column, so reject the attempt loudly rather
      // than silently ignoring it.
      if (
        existingCol &&
        col.isVirtual !== undefined &&
        Boolean(col.isVirtual) !== Boolean(existingCol.isVirtual)
      ) {
        throw new Error(
          `Cannot change whether column "${col.column}" is a virtual column`,
        );
      }

      const isVirtual = existingCol ? !!existingCol.isVirtual : !!col.isVirtual;

      if (!isVirtual) {
        if (col.sql !== undefined) {
          throw new Error(
            `Only virtual columns can have a SQL expression: "${col.column}"`,
          );
        }
        continue;
      }

      touchesVirtualColumn = true;

      // A virtual column must be removed via the delete endpoint so the
      // dependency guard runs; a soft delete here would strip its expression
      // out of generated SQL and break dependents silently.
      if (col.deleted !== undefined) {
        throw new Error(
          "Virtual columns must be deleted using the virtual column endpoint",
        );
      }

      if (!existingCol) {
        validateVirtualColumnProps(col);
        continue;
      }

      // Partial update: an omitted `sql` preserves the existing expression, but
      // an explicit one must still be non-empty and structurally safe.
      if (col.sql !== undefined) {
        if (!col.sql.trim()) {
          throw new Error("Virtual columns require a SQL expression");
        }
        validateVirtualColumnSql(col.sql);
      }
    }

    // A virtual column's expression is raw SQL inlined into generated queries,
    // so writing one needs the gate `canUpdateFactTable` deliberately skips for
    // columns-only updates.
    if (
      touchesVirtualColumn &&
      !req.context.permissions.canManageFactTableVirtualColumn(factTable)
    ) {
      req.context.permissions.throwPermissionError();
    }
    columnRefreshWillBeNeeded = columnsNeedDetection(
      mergeUpsertColumns(factTable.columns, incomingColumns).columns,
    );
  }

  const parentUpdateData = { ...data };
  delete parentUpdateData.columns;

  const willRefresh =
    needsColumnRefresh(factTable, parentUpdateData) ||
    columnRefreshWillBeNeeded;
  if (willRefresh) {
    parentUpdateData.columnRefreshPending = true;
  }

  if (
    !req.context.permissions.canUpdateFactTable(factTable, parentUpdateData)
  ) {
    req.context.permissions.throwPermissionError();
  }

  if (incomingColumns) {
    await upsertColumns({
      context: req.context,
      factTable,
      columns: incomingColumns,
    });
  }

  await updateFactTableInDb(req.context, factTable, parentUpdateData);
  if (willRefresh) {
    await queueFactTableColumnsRefresh(factTable);
  }

  if (parentUpdateData.tags) {
    await addTagsDiff(
      req.organization.id,
      factTable.tags,
      parentUpdateData.tags,
    );
  }

  const updatedFactTable = {
    ...factTable,
    ...req.body,
    columns: factTable.columns,
    columnRefreshPending: willRefresh ? true : factTable.columnRefreshPending,
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
