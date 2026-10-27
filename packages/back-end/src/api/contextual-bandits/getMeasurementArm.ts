import { contextualBanditEndpoints } from "shared/api-endpoints";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getMeasurementArmResultsSummary } from "back-end/src/enterprise/services/contextualBanditMeasurementArm";
import { loadContextualBanditForRead } from "./_shared";

export const getContextualBanditMeasurementArm = createApiRequestHandler(
  contextualBanditEndpoints.getContextualBanditMeasurementArm,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const measurementArm = await getMeasurementArmResultsSummary(
    req.context,
    contextualBandit,
  );
  return { measurementArm };
});
