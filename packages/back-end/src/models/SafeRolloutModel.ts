import { z } from "zod";
import { experimentAnalysisSummary } from "back-end/src/validators/experiments";
import { baseSchema, MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "safeRollout";

const safeRolloutStatus = [
  "running",
  "rolled-back",
  "released",
  "completed",
  "draft",
] as const;
export type SafeRolloutStatus = typeof safeRolloutStatus[number];

const safeRollout = z.object({
  trackingKey: z.string(),
  datasource: z.string(),
  exposureQueryId: z.string(),
  hashAttribute: z.string(),
  seed: z.string(),
  guardrailMetrics: z.array(z.string()),
  status: z.enum(safeRolloutStatus),
  startedAt: z.date().optional(),
  lastSnapshotAttempt: z.date().optional(),
  nextSnapshotAttempt: z.date().optional(),
  autoSnapshots: z.boolean().default(true),
  featureId: z.string(),
  ruleId: z.string(),
  coverage: z.number(),
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
  | "datasource"
  | "exposureQueryId"
  | "hashAttribute"
  | "maxDurationDays"
  | "seed"
  | "guardrailMetrics"
  | "trackingKey"
>;
export class SafeRolloutModel extends BaseClass {
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

  public async findByRuleId(ruleId: string) {
    return await this._findOne({ ruleId });
  }

  public async findByRuleIds(ruleIds: string[]) {
    return await this._find({ ruleId: { $in: ruleIds } });
  }

  public async getAllByFeatureId(featureId: string) {
    return await this._find({ featureId });
  }
}
