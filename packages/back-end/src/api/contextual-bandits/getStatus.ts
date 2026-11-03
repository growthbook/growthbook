import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getContextualBanditStatusForUi } from "back-end/src/enterprise/services/contextualBandits";
import {
  loadContextualBanditForRead,
  toApiContextualBanditLatestStatus,
} from "./_shared";

export const getContextualBanditStatus = createApiRequestHandler(
  contextualBanditEndpoints.getContextualBanditStatus,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );

  const latestSnapshotSummary = await getContextualBanditStatusForUi(
    req.context,
    contextualBandit,
  );

  return {
    latest: toApiContextualBanditLatestStatus(latestSnapshotSummary),
  };
});
