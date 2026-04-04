import { z } from "zod";
import { RampScheduleInterface } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";

const listRampSchedulesValidator = {
  querySchema: z.object({
    featureId: z.string().optional(),
    ruleId: z.string().optional(),
    environment: z.string().optional(),
    status: z.string().optional(),
    limit: z.coerce.number().int().default(10),
    offset: z.coerce.number().int().default(0),
  }),
};

export const listRampSchedules = createApiRequestHandler(
  listRampSchedulesValidator,
)(async (req) => {
  let schedules: RampScheduleInterface[];
  const { featureId, ruleId, environment, status } = req.query;

  if (ruleId) {
    // Direct DB query for schedules targeting a specific rule+environment
    schedules = await req.context.models.rampSchedules.findByTargetRule(
      ruleId,
      environment ?? "",
    );
    // If featureId is also supplied, restrict further
    if (featureId) {
      schedules = schedules.filter((s) => s.entityId === featureId);
    }
  } else if (featureId) {
    schedules =
      await req.context.models.rampSchedules.getAllByFeatureId(featureId);
  } else {
    schedules = await req.context.models.rampSchedules.getAll();
  }

  if (status) {
    schedules = schedules.filter((s) => s.status === status);
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
