import {
  getExperimentLogValidator,
  eventUserToApiEventUser,
  auditUserToEventUser,
} from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getAuditHistory } from "back-end/src/models/AuditModel";

function parseIntWithDefaultCapped(
  value: string | undefined,
  defaultValue: number,
  max: number,
): number {
  if (!value) return defaultValue;
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 1) return defaultValue;
  return Math.min(parsed, max);
}

export const getExperimentLog = createApiRequestHandler(
  getExperimentLogValidator,
)(async (req) => {
  const experiment = await getExperimentById(req.context, req.params.id);
  if (!experiment) {
    throw new Error("Could not find experiment with that id");
  }

  const limit = parseIntWithDefaultCapped(req.query.limit, 50, 100);
  const before = req.query.cursor ? new Date(req.query.cursor) : undefined;

  const history = await getAuditHistory(
    req.context.org.id,
    "experiment",
    experiment.id,
    limit,
    { before },
  );

  return {
    events: history.events.map((event) => ({
      id: event.id,
      event: event.event,
      dateCreated: event.dateCreated.toISOString(),
      user: eventUserToApiEventUser(auditUserToEventUser(event.user)) ?? null,
      ...(event.reason ? { reason: event.reason } : {}),
      ...(event.details ? { details: event.details } : {}),
    })),
    total: history.total,
    nextCursor: history.nextCursor?.toISOString() ?? null,
  };
});
