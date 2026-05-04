import { getExperimentContextualBanditContextsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

/**
 * GET /experiments/:id/contextual-bandit/contexts
 *
 * Two modes:
 *  - With `?contextId=...`: history of weights for that one context across
 *    every CBE for the experiment (newest first).
 *  - Without `contextId`: latest per-context weights from the most recent
 *    CBE on the last phase.
 */
export const getExperimentContextualBanditContexts = createApiRequestHandler(
  getExperimentContextualBanditContextsValidator,
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

  if (req.query.contextId) {
    const history =
      await req.context.models.contextualBanditEvents.listForContext(
        experiment.id,
        req.query.contextId,
      );
    return {
      history: history.map((h) => ({
        eventId: h.eventId,
        date: h.date.toISOString(),
        weights: h.weights,
        leafId: h.leafId,
      })),
    };
  }

  const phaseIndex = Math.max(0, experiment.phases.length - 1);
  const latest =
    await req.context.models.contextualBanditEvents.getLatestForExperiment(
      experiment.id,
      phaseIndex,
    );
  if (!latest) {
    return { contexts: [] };
  }

  return {
    contexts: latest.contextResults.map((c) => ({
      contextId: c.contextId,
      leafId: c.leafId,
      n: c.n,
      weights: c.weights,
    })),
  };
});
