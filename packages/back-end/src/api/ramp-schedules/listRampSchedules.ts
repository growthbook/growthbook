import { z } from "zod";
import { RampScheduleInterface } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

const listRampSchedulesValidator = {
  querySchema: z.object({
    featureId: z.string().optional(),
    status: z.string().optional(),
    limit: z.coerce.number().int().default(10),
    offset: z.coerce.number().int().default(0),
  }),
};

export const listRampSchedules = createApiRequestHandler(
  listRampSchedulesValidator,
)(async (req) => {
  let schedules: RampScheduleInterface[];

  if (req.query.featureId) {
    schedules = await req.context.models.rampSchedules.getAllByFeatureId(
      req.query.featureId,
    );
  } else {
    schedules = await req.context.models.rampSchedules.getAll();
  }

  if (req.query.status) {
    schedules = schedules.filter((s) => s.status === req.query.status);
  }

  const { filtered, returnFields } = applyPagination(
    schedules.sort(
      (a, b) =>
        new Date(b.dateCreated).getTime() - new Date(a.dateCreated).getTime(),
    ),
    req.query,
  );

  return {
    rampSchedules: filtered,
    ...returnFields,
  };
});
