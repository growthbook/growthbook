import { getCbCurrentValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { loadCbForRead } from "./_shared";

export const getCbCurrent = createApiRequestHandler(getCbCurrentValidator)(
  async (req) => {
    const { cb } = await loadCbForRead(req.context, req.params.id);
    const phase = cb.phases.length - 1;
    const latestCBE =
      await req.context.models.contextualBanditEvents.getLatestForContextualBandit(
        cb.id,
        phase,
      );
    return {
      phaseWeights: cb.phases[phase]?.currentLeafWeights ?? [],
      latestEvent: latestCBE
        ? {
            id: latestCBE.id,
            contextualBandit: latestCBE.contextualBandit,
            phase: latestCBE.phase,
            snapshotId: latestCBE.snapshotId,
            weightsWereUpdated: latestCBE.weightsWereUpdated,
            dateCreated: latestCBE.dateCreated.toISOString(),
          }
        : null,
    };
  },
);
