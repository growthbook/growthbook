import {
  cancelAggregatedFactTableRunValidator,
  refreshFactTableColumnsValidator,
} from "shared/validators";
import {
  getFactTable,
  toFactTableApiInterface,
  updateFactTable,
} from "back-end/src/models/FactTableModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { queueFactTableColumnsRefresh } from "back-end/src/jobs/refreshFactTableColumns";
import { cancelRunningAggregatedFactTableRun } from "back-end/src/services/aggregatedFactTables";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const cancelAggregatedFactTableRun = createApiRequestHandler(
  cancelAggregatedFactTableRunValidator,
)(async (req) => {
  const { context } = req;
  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) throw new NotFoundError("Could not find fact table");
  const datasource = await getDataSourceById(context, factTable.datasource);
  if (!datasource) {
    throw new BadRequestError("Could not find datasource for this fact table");
  }
  // Same gate as starting a refresh
  if (!context.permissions.canUpdateDataSourceSettings(datasource)) {
    context.permissions.throwPermissionError();
  }
  const { idType } = req.params;
  if (
    !(factTable.aggregatedFactTableSettings?.idTypes ?? []).includes(idType)
  ) {
    throw new BadRequestError(
      `id type '${idType}' is not enabled for shared daily aggregated tables on this fact table.`,
    );
  }
  const cancelled = await cancelRunningAggregatedFactTableRun(
    context,
    factTable,
    idType,
  );
  return { cancelled };
});

export const refreshFactTableColumns = createApiRequestHandler(
  refreshFactTableColumnsValidator,
)(async (req) => {
  const { context } = req;
  const factTable = await getFactTable(context, req.params.id);
  if (!factTable) throw new NotFoundError("Could not find fact table");

  await updateFactTable(context, factTable, { columnRefreshPending: true });
  await queueFactTableColumnsRefresh(factTable);

  return {
    factTable: await resolveOwnerEmail(
      toFactTableApiInterface({ ...factTable, columnRefreshPending: true }),
      context,
    ),
  };
});
