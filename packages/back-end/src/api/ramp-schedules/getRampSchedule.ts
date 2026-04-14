import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";

const getRampScheduleValidator = {
  paramsSchema: z.object({ id: z.string() }),
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
