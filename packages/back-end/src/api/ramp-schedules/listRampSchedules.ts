import { z } from "zod";
import { RampScheduleInterface } from "shared/validators";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { getAllFeatures } from "back-end/src/models/FeatureModel";

const listRampSchedulesValidator = {
  querySchema: z.object({
    featureId: z.string().optional(),
    project: z.string().optional(),
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

  if (req.query.featureId) {
    schedules = await req.context.models.rampSchedules.getAllByFeatureId(
      req.query.featureId,
    );
  } else if (req.query.project) {
    const features = await getAllFeatures(req.context, {
      projects: [req.query.project],
    });
    const perFeature = await Promise.all(
      features.map((f) =>
        req.context.models.rampSchedules.getAllByFeatureId(f.id),
      ),
    );
    schedules = perFeature.flat();
  } else {
    schedules = await req.context.models.rampSchedules.getAll();
  }

  if (req.query.status) {
    schedules = schedules.filter((s) => s.status === req.query.status);
  }
  if (req.query.ruleId) {
    const { ruleId, environment } = req.query;
    schedules = schedules.filter((s) =>
      s.targets.some(
        (t) =>
          t.ruleId === ruleId &&
          (environment === undefined || t.environment === environment),
      ),
    );
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
