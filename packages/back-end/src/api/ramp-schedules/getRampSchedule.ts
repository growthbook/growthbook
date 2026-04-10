import { z } from "zod";
import { apiRampScheduleValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";

const getRampScheduleValidator = {
  paramsSchema: z.object({ id: z.string() }),
  responseSchema: z.object({ rampSchedule: apiRampScheduleValidator }),
  method: "get" as const,
  path: "/ramp-schedules/{id}",
  operationId: "getRampSchedule",
  summary: "Get a single ramp schedule",
  tags: ["ramp-schedules"],
};

export const getRampSchedule = createApiRequestHandler(
  getRampScheduleValidator,
)(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );

  if (!schedule) {
    throw new Error("Ramp schedule not found");
  }

  return { rampSchedule: schedule };
});
