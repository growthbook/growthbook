import { z } from "zod";
import { getCollection } from "back-end/src/util/mongo.util";
import { experimentAnalysisSummary } from "back-end/src/validators/experiments";
import { safeRolloutStatus } from "back-end/src/validators/shared";
import { baseSchema, MakeModelClass } from "./BaseModel";
const COLLECTION = "safeRolloutAnalysisSettings";

// Export shared validators
export { safeRolloutStatus };

export const safeRollout = z.object({
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
  collectionName: COLLECTION,
  idPrefix: "sras_",
  auditLog: {
    entity: "safeRollout",
    createEvent: "safeRollout.create",
    updateEvent: "safeRollout.update",
    deleteEvent: "safeRollout.delete",
  },
  globallyUniqueIds: true,
});

// TODO partial?
export type SafeRolloutInterfaceCreateFields = Partial<Pick<
SafeRolloutInterface,
"datasource" | "exposureQueryId" | "hashAttribute" | "maxDurationDays" | "seed" | "guardrailMetrics" | "trackingKey"
>>;

export class SafeRolloutModel extends BaseClass {
  protected canRead(_doc: SafeRolloutInterface): boolean {
    return true;
  }
  protected canReadAll() {
    return true;
  }
  protected canCreate() {
    return true;
  }

  protected canUpdate(_doc: SafeRolloutInterface) {
    return true;
  }

  protected canDelete(_doc: SafeRolloutInterface) {
    return true;
  }

  public toApiInterface(doc: SafeRolloutInterface): SafeRolloutInterface {
    return {
      id: doc.id,
      organization: doc.organization,
      dateCreated: doc.dateCreated,
      dateUpdated: doc.dateUpdated,
      lastSnapshotAttempt: doc.lastSnapshotAttempt,
      nextSnapshotAttempt: doc.nextSnapshotAttempt,
      autoSnapshots: doc.autoSnapshots,
      featureId: doc.featureId,
      ruleId: doc.ruleId,
      coverage: doc.coverage,
      maxDurationDays: doc.maxDurationDays,
      startedAt: doc.startedAt,
      status: doc.status,
      datasource: doc.datasource,
      exposureQueryId: doc.exposureQueryId,
      hashAttribute: doc.hashAttribute,
      seed: doc.seed,
      guardrailMetrics: doc.guardrailMetrics,
      trackingKey: doc.trackingKey,
    };
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
export async function getAllRolloutsToBeUpdated() {
  const now = new Date();
  // get all the rollout settings that need a snapshot update
  const rolloutSettings = await getCollection(COLLECTION).find({
    nextSnapshotUpdate: { $lte: now },
    autoSnapshots: true,
  });
  return rolloutSettings.map((setting) => this.toApiInterface(setting));
}
