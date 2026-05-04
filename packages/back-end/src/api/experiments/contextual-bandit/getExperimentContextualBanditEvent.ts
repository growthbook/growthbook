import { getExperimentContextualBanditEventValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

/**
 * GET /experiments/:id/contextual-bandit/events/:eventId
 *
 * Returns a single CBE for an experiment. The eventId must belong to
 * the experiment (defense-in-depth: even if a caller knows a foreign
 * event id, this endpoint refuses to leak it).
 */
export const getExperimentContextualBanditEvent = createApiRequestHandler(
  getExperimentContextualBanditEventValidator,
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

  const event = await req.context.models.contextualBanditEvents.getById(
    req.params.eventId,
  );
  if (!event || event.experiment !== experiment.id) {
    throw new Error("Could not find contextual bandit event with that id");
  }

  return {
    contextualBanditEvent:
      req.context.models.contextualBanditEvents.toApi(event),
  };
});
