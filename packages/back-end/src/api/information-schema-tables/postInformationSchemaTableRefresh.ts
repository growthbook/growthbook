import { postInformationSchemaTableRefreshValidator } from "shared/validators";
import { getInformationSchemaTableById } from "back-end/src/models/InformationSchemaTablesModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { refreshInformationSchemaTable } from "back-end/src/services/informationSchema";
import { NotFoundError } from "back-end/src/util/errors";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ReqContext } from "back-end/types/request";
import { toInformationSchemaTableApiInterface } from "./getInformationSchemaTable";

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
  // Synchronous like the app's table refresh, so a failure reaches the caller
  const refreshed = await refreshInformationSchemaTable(
    context as ReqContext,
    table,
  );
  return {
    informationSchemaTable: toInformationSchemaTableApiInterface(refreshed),
  };
});
