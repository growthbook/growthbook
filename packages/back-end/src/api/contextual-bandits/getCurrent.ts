import { getContextualBanditCurrentWeightsValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadContextualBanditForRead } from "./_shared";

export const getContextualBanditCurrentWeights = createApiRequestHandler(
  getContextualBanditCurrentWeightsValidator,
)(async (req) => {
  const { contextualBandit } = await loadContextualBanditForRead(
    req.context,
    req.params.id,
  );
  const latestContextualBanditEvent =
    await req.context.models.contextualBanditEvents.getLatestForContextualBandit(
      contextualBandit.id,
    );
  return {
    currentLeafWeights: contextualBandit.currentLeafWeights ?? [],
    latestEvent: latestContextualBanditEvent
      ? {
          id: latestContextualBanditEvent.id,
          contextualBandit: latestContextualBanditEvent.contextualBandit,
          snapshotId: latestContextualBanditEvent.snapshotId,
          weightsWereUpdated: latestContextualBanditEvent.weightsWereUpdated,
          degreesOfFreedom: latestContextualBanditEvent.degreesOfFreedom,
          dateCreated: latestContextualBanditEvent.dateCreated.toISOString(),
        }
      : null,
  };
});
