import { z } from "zod";
import { createApiRequestHandler } from "back-end/src/util/handler";

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

  // Do not allow deletion of running schedules to avoid orphaned revisions
  if (["running", "pending-approval"].includes(schedule.status)) {
    throw new Error(
      `Cannot delete a ramp schedule in status "${schedule.status}". Pause or complete the schedule first.`,
    );
  }

  await req.context.models.rampSchedules.deleteById(schedule.id);

  return { deletedId: schedule.id };
});
