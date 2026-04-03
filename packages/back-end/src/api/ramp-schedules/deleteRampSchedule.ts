import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { dispatchRampEvent } from "back-end/src/services/rampSchedule";

const deleteRampScheduleValidator = {
  paramsSchema: z.object({ id: z.string() }),
};

export const deleteRampSchedule = createApiRequestHandler(
  deleteRampScheduleValidator,
)(async (req) => {
  const schedule = await req.context.models.rampSchedules.getById(
    req.params.id,
  );
  if (!schedule) {
    throw new Error("Ramp schedule not found");
  }

  if (["running", "pending-approval"].includes(schedule.status)) {
    throw new Error(
      `Cannot delete a ramp schedule in status "${schedule.status}". Pause or complete the schedule first.`,
    );
  }

  await req.context.models.rampSchedules.deleteById(schedule.id);

  await dispatchRampEvent(req.context, schedule, "rampSchedule.deleted", {
    object: {
      rampScheduleId: schedule.id,
      rampName: schedule.name,
      orgId: req.context.org.id,
    },
  });

  return { deletedId: schedule.id };
});
