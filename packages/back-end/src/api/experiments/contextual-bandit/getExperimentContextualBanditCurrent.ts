import { getExperimentContextualBanditCurrentValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

/**
 * GET /experiments/:id/contextual-bandit/current
 *
 * Returns the latest ContextualBanditEvent for the requested phase
 * (defaults to the last phase). Returns `{}` when no event has been
 * persisted yet for that phase — this is normal during burn-in.
 */
export const getExperimentContextualBanditCurrent = createApiRequestHandler(
  getExperimentContextualBanditCurrentValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }
  if (!experiment.isContextualBandit) {
    throw new Error("Experiment is not a contextual bandit experiment");
  }
  if (!req.context.permissions.canReadSingleProjectResource(experiment.project)) {
    req.context.permissions.throwPermissionError();
  }

  const phaseIndex =
    req.query.phase ?? Math.max(0, experiment.phases.length - 1);

  const event =
    await req.context.models.contextualBanditEvents.getLatestForExperiment(
      experiment.id,
      phaseIndex,
    );

  if (!event) {
    return {};
  }

  return {
    contextualBanditEvent:
      req.context.models.contextualBanditEvents.toApi(event),
  };
});
