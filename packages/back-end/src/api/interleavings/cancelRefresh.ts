import { cancelInterleavingRefreshValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { cancelInterleavingLatestRunningSnapshot } from "back-end/src/enterprise/services/interleavings";
import { loadInterleavingForRead } from "./_shared";

export const cancelInterleavingRefresh = createApiRequestHandler(
  cancelInterleavingRefreshValidator,
)(async (req) => {
  const { interleaving } = await loadInterleavingForRead(
    req.context,
    req.params.id,
  );

  const datasource = await getDataSourceById(
    req.context,
    interleaving.datasource,
  );
  if (!datasource) {
    throw new Error(`Datasource not found: ${interleaving.datasource}`);
  }
  if (!req.context.permissions.canRunInterleavingQueries(datasource)) {
    req.context.permissions.throwPermissionError();
  }

  const cancelled = await cancelInterleavingLatestRunningSnapshot(
    req.context,
    interleaving,
  );
  return { cancelled };
});
