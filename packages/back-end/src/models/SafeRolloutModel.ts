import { z } from "zod";
import { experimentAnalysisSummary } from "back-end/src/validators/experiments";
import { baseSchema, MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "saferollout";

export const safeRolloutStatusArray = [
  "running",
  "rolled-back",
  "released",
  "stopped",
] as const;
export type SafeRolloutStatus = typeof safeRolloutStatusArray[number];

const safeRollout = z.object({
  datasourceId: z.string(),
  exposureQueryId: z.string(),
  hashAttribute: z.string(),
  guardrailMetricIds: z.array(z.string()),
  status: z.enum(safeRolloutStatusArray),
  startedAt: z.date().optional(),
  lastSnapshotAttempt: z.date().optional(),
  nextSnapshotAttempt: z.date().optional(),
  autoSnapshots: z.boolean().default(true),
  featureId: z.string(),
  ruleId: z.string(),
  maxDurationDays: z.number(),
  analysisSummary: experimentAnalysisSummary,
});
export const safeRolloutValidator = baseSchema
  .extend(safeRollout.shape)
  .strict();
export type SafeRolloutInterface = z.infer<typeof safeRolloutValidator>;

const BaseClass = MakeModelClass({
  schema: safeRolloutValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "sr_",
  auditLog: {
    entity: "safeRollout",
    createEvent: "safeRollout.create",
    updateEvent: "safeRollout.update",
    deleteEvent: "safeRollout.delete",
  },
  globallyUniqueIds: true,
});

export type CreateSafeRolloutInterface = Pick<
  SafeRolloutInterface,
  | "datasourceId"
  | "exposureQueryId"
  | "maxDurationDays"
  | "guardrailMetricIds"
  | "hashAttribute"
>;
export class SafeRolloutModel extends BaseClass {
  // TODO: fix permissions
  protected canRead() {
    return true;
  }
  protected canCreate() {
    return true;
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }

  public async findByIds(ids: string[]) {
    return await this._find({ id: { $in: ids } });
  }

  public async getAllByFeatureId(featureId: string) {
    return await this._find({ featureId });
  }
}
