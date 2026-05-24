import { getContextualBanditEventValidator } from "shared/validators";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { createApiRequestHandler } from "back-end/src/util/handler";

export const getContextualBanditEvent = createApiRequestHandler(
  getContextualBanditEventValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  const events =
    await req.context.models.contextualBanditEvents.listForExperiment(
      experiment.id,
      experiment.phases.length - 1,
      100,
    );

  const event = events.find((e) => e.id === req.params.eventId);
  if (!event || event.experiment !== experiment.id) {
    throw new Error("Event not found");
  }

  return {
    event: {
      id: event.id,
      experiment: event.experiment,
      phase: event.phase,
      snapshotId: event.snapshotId,
      weightsWereUpdated: event.weightsWereUpdated,
      dateCreated: event.dateCreated.toISOString(),
    },
  };
});
