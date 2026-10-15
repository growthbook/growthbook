import { postInformationSchemaTableRefreshValidator } from "shared/validators";
import { refreshInformationSchemaTable } from "back-end/src/services/informationSchema";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { ReqContext } from "back-end/types/request";
import {
  getOrCreateInformationSchemaTable,
  toInformationSchemaTableApiInterface,
} from "./getInformationSchemaTable";

export const postInformationSchemaTableRefresh = createApiRequestHandler(
  postInformationSchemaTableRefreshValidator,
)(async (req) => {
  const { context } = req;
  const { table, datasource, created } =
    await getOrCreateInformationSchemaTable(context, req.params.tableId);
  // A table read for the first time just now is already fresh
  if (created) {
    return {
      informationSchemaTable: toInformationSchemaTableApiInterface(table),
    };
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
