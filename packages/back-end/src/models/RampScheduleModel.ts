import { UpdateProps } from "shared/types/base-model";
import {
  RampScheduleInterface,
  rampScheduleValidator,
} from "shared/validators";
import { getCollection } from "back-end/src/util/mongo.util";
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
    nextProcessAt: null,
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
}

/**
 * Cross-org query for the poller: returns minimal docs for every schedule
 * that is due for processing or pending crash-recovery.
 * Bypasses org-scoped BaseModel intentionally — the caller must load the
 * full document via a proper context after queuing the work.
 */
export async function findSchedulesDueForProcessing(
  now: Date,
): Promise<{ id: string; organization: string }[]> {
  const docs = await getCollection(COLLECTION_NAME)
    .find(
      {
        $or: [
          // Primary path: any schedule with a due process time
          { nextProcessAt: { $ne: null, $lte: now } },
          // Crash recovery: pending schedules whose activation hook may have missed
          {
            status: "pending",
            "targets.activatingRevisionVersion": { $exists: true, $ne: null },
          },
        ],
      },
      { projection: { _id: 1, id: 1, organization: 1 } },
    )
    .toArray();

  return docs.map((d) => ({
    id: (d.id as string | undefined) || String(d._id),
    organization: d.organization as string,
  }));
}
