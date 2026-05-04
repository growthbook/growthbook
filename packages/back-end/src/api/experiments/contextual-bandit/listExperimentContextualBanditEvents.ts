import { listExperimentContextualBanditEventsValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

/**
 * GET /experiments/:id/contextual-bandit/events
 *
 * Cursor-paginated list of CB events for an experiment, newest-first.
 * `nextCursor` is an ISO date string usable as the next request's `cursor`.
 */
export const listExperimentContextualBanditEvents = createApiRequestHandler(
  listExperimentContextualBanditEventsValidator,
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

  const { events, nextCursor, hasMore } =
    await req.context.models.contextualBanditEvents.listForExperiment(
      experiment.id,
      {
        cursor: req.query.cursor,
        limit: req.query.limit,
      },
    );

  return {
    contextualBanditEvents: events.map((e) =>
      req.context.models.contextualBanditEvents.toApi(e),
    ),
    nextCursor,
    hasMore,
  };
});
