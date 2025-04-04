import { z } from "zod";
import { Collection } from "mongodb";
import { ApiSafeRolloutAnalysisSettings } from "back-end/types/openapi";
import { getCollection } from "back-end/src/util/mongo.util";
import { baseSchema, MakeModelClass } from "./BaseModel";
const COLLECTION = "safeRolloutAnalysisSettings";

export const SafeRolloutAnalysisSettingsValidator = baseSchema
  .extend({
    lastSnapshotAttempt: z.date().optional(),
    nextSnapshotAttempt: z.date().optional(),
    autoSnapshotUpdate: z.boolean(),
    ruleId: z.string(),
    featureId: z.string(),
  })
  .strict();
export type SafeRolloutAnalysisSettingsInterface = z.infer<
  typeof SafeRolloutAnalysisSettingsValidator
>;

const BaseClass = MakeModelClass({
  schema: SafeRolloutAnalysisSettingsValidator,
  collectionName: COLLECTION,
  idPrefix: "sras_",
  auditLog: {
    entity: "safeRolloutAnalysisSettings",
    createEvent: "safeRolloutAnalysisSettings.create",
    updateEvent: "safeRolloutAnalysisSettings.update",
    deleteEvent: "safeRolloutAnalysisSettings.delete",
  },
  globallyUniqueIds: true,
});

interface createProps {
  nextSnapshotUpdate?: Date;
  autoSnapshotUpdate: boolean;
  ruleId: string;
  featureId: string;
}

export class SafeRolloutAnalysisSettings extends BaseClass {
  protected canRead(doc: SafeRolloutAnalysisSettingsInterface): boolean {
    return true;
  }
  protected canReadAll() {
    return true;
  }
  protected canCreate() {
    return true;
  }

  protected canUpdate(doc: SafeRolloutAnalysisSettingsInterface) {
    return true;
  }

  protected canDelete(doc: SafeRolloutAnalysisSettingsInterface) {
    return true;
  }

  public create(props: createProps) {
    return super.create(props);
  }

  public toApiInterface(
    doc: SafeRolloutAnalysisSettingsInterface
  ): ApiSafeRolloutAnalysisSettings {
    return {
      id: doc.id,
      organization: doc.organization,
      lastSnapshotAttempt: doc.lastSnapshotAttempt || null,
      nextSnapshotAttempt: doc.nextSnapshotAttempt || null,
      autoSnapshotUpdate: doc.autoSnapshotUpdate,
      ruleId: doc.ruleId,
      featureId: doc.featureId,
    };
  }

  public async findByRuleId(ruleId: string) {
    return await this._findOne({ ruleId });
  }
}
export async function getAllRolloutsToBeUpdated() {
  const now = new Date();
  // get all the rollout settings that need a snapshot update
  const rolloutSettings = await getCollection(COLLECTION).find({
    nextSnapshotUpdate: { $lte: now },
    autoSnapshotUpdate: true,
  });
  return rolloutSettings.map((setting) => this.toApiInterface(setting));
}
