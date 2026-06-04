import { getContextualBanditCurrentValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { markLegacyCBRouteDeprecated, requireCBPermission } from "./_shared";

export const getContextualBanditCurrent = createApiRequestHandler(
  getContextualBanditCurrentValidator,
)(async (req) => {
  markLegacyCBRouteDeprecated(
    req.res!,
    "/experiments/:id/contextual-bandit/current",
    "/contextual-bandits/:id/current",
  );

  if (!req.context.hasPremiumFeature("contextual-bandits")) {
    req.context.throwPlanDoesNotAllowError(
      "Contextual Bandits require an Enterprise plan.",
    );
  }

  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  // PR-8 Commit 4 dropped the `"contextual-bandit"` experimentType enum
  // value, so this route is reachable only via the experiment id of a
  // CB-paired legacy experiment. The `getByExperimentId` lookup below
  // gates the actual CB resolution and returns an empty payload if no
  // paired CB exists.
  requireCBPermission(req.context, experiment, "read");

  // PR-8 Commit 2: event collection is keyed by CB id now. Deleted with
  // this whole file in Commit 6.
  const cb = await req.context.models.contextualBandits.getByExperimentId(
    experiment.id,
  );
  if (!cb) {
    return { phaseWeights: [], latestEvent: null };
  }

  const phase = cb.phases.length - 1;
  const latestCBE =
    await req.context.models.contextualBanditEvents.getLatestForContextualBandit(
      cb.id,
      phase,
    );

  const phaseWeights = cb.phases[phase]?.currentLeafWeights;

  return {
    phaseWeights: phaseWeights ?? [],
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
});
