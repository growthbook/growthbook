import { UpdateProps } from "shared/types/base-model";
import {
  RampScheduleInterface,
  rampScheduleValidator,
} from "shared/validators";
import { getAffectedSDKPayloadKeys } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";
import { getFeature } from "back-end/src/models/FeatureModel";
import { queueSDKPayloadRefresh } from "back-end/src/services/features";
import { MakeModelClass } from "./BaseModel";

export const COLLECTION_NAME = "rampschedules";

const BaseClass = MakeModelClass({
  schema: rampScheduleValidator,
  collectionName: COLLECTION_NAME,
  idPrefix: "rs_",
  auditLog: {
    entity: "rampSchedule",
    createEvent: "rampSchedule.create",
    updateEvent: "rampSchedule.update",
    deleteEvent: "rampSchedule.delete",
  },
  globallyUniquePrimaryKeys: true,
  defaultValues: {
    status: "pending" as const,
    currentStepIndex: -1,
    nextStepAt: null,
  },
});

export class RampScheduleModel extends BaseClass {
  protected canRead() {
    return this.context.permissions.canViewFeatureModal(undefined);
  }
  protected canCreate() {
    return this.context.permissions.canCreateFeature({ project: undefined });
  }
  protected canUpdate(
    _existing: RampScheduleInterface,
    _updates: UpdateProps<RampScheduleInterface>,
  ) {
    return this.context.permissions.canUpdateFeature(
      { project: undefined },
      { project: undefined },
    );
  }
  protected canDelete(_existing: RampScheduleInterface) {
    return this.context.permissions.canDeleteFeature({ project: undefined });
  }

  public async getAllByEntityId(
    entityType: string,
    entityId: string,
  ): Promise<RampScheduleInterface[]> {
    return this._find({ entityType, entityId });
  }

  public async getAllByFeatureId(
    featureId: string,
  ): Promise<RampScheduleInterface[]> {
    return this._find({ entityType: "feature", entityId: featureId });
  }

  public async getActiveSchedules(): Promise<RampScheduleInterface[]> {
    return this._find({
      status: { $in: ["running", "pending", "pending-approval"] },
    });
  }

  public async findByActivatingRevision(
    featureId: string,
    version: number,
  ): Promise<RampScheduleInterface[]> {
    return this._find({
      status: "pending",
      targets: {
        $elemMatch: {
          entityType: "feature",
          entityId: featureId,
          activatingRevisionVersion: version,
        },
      },
    });
  }

  protected async afterUpdate(
    existing: RampScheduleInterface,
    updates: UpdateProps<RampScheduleInterface>,
  ) {
    const stepChanged =
      updates.currentStepIndex !== undefined &&
      updates.currentStepIndex !== existing.currentStepIndex;

    const statusChanged =
      updates.status !== undefined && updates.status !== existing.status;

    if ((stepChanged || statusChanged) && existing.entityType === "feature") {
      const feature = await getFeature(this.context, existing.entityId);
      if (!feature) return;

      const environments = existing.targets
        .filter((t) => t.environment)
        .map((t) => t.environment as string);

      const envIds =
        environments.length > 0
          ? environments
          : getEnvironmentIdsFromOrg(this.context.org);

      queueSDKPayloadRefresh({
        context: this.context,
        payloadKeys: getAffectedSDKPayloadKeys([feature], envIds),
        auditContext: {
          event: "step changed",
          model: "rampschedule",
          id: existing.id,
        },
      });
    }
  }
}
