import { z } from "zod";
import {
  apiPaginationFieldsValidator,
  apiRampScheduleInterface,
  RampScheduleInterface,
} from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { rampScheduleToApiInterface } from "back-end/src/models/RampScheduleModel";

const listRampSchedulesValidator = {
  method: "get" as const,
  path: "/ramp-schedules",
  operationId: "listRampSchedules",
  summary: "List ramp schedules",
  tags: ["ramp-schedules"],
  responseSchema: z
    .object({
      rampSchedules: z.array(apiRampScheduleInterface),
    })
    .extend(apiPaginationFieldsValidator.shape),
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
    // Omit environment when not provided so results span every env the rule
    // controls (including wildcard targets).
    schedules = await req.context.models.rampSchedules.findByTargetRule(
      ruleId,
      environment,
    );
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
    rampSchedules: filtered.map(rampScheduleToApiInterface),
    ...returnFields,
  };
});
