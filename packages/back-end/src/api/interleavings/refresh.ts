import { refreshInterleavingValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { runInterleavingRefresh } from "back-end/src/enterprise/services/interleavings";
import { loadInterleavingForRead } from "./_shared";

export const refreshInterleaving = createApiRequestHandler(
  refreshInterleavingValidator,
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

  const { snapshotId } = await runInterleavingRefresh(
    req.context,
    interleaving,
  );
  return { snapshotId };
});
