import { postInformationSchemaTableRefreshValidator } from "shared/validators";
import { getInformationSchemaTableById } from "back-end/src/models/InformationSchemaTablesModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { queueUpdateStaleInformationSchemaTable } from "back-end/src/jobs/updateStaleInformationSchemaTable";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const postInformationSchemaTableRefresh = createApiRequestHandler(
  postInformationSchemaTableRefreshValidator,
)(async (req) => {
  const { context } = req;
  const table = await getInformationSchemaTableById(
    context.org.id,
    req.params.tableId,
  );
  const datasource =
    table && (await getDataSourceById(context, table.datasourceId));
  if (!table || !datasource) {
    throw new NotFoundError(
      "Could not find information schema table with that id",
    );
  }
  if (!context.permissions.canRunSchemaQueries(datasource)) {
    context.permissions.throwPermissionError();
  }
  await queueUpdateStaleInformationSchemaTable(context.org.id, table.id);
  return { queued: true as const };
});
