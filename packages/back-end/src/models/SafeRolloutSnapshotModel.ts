import { FilterQuery } from "mongoose";
import {
  SafeRolloutSnapshotInterface,
  safeRolloutSnapshotInterface,
} from "shared/validators";
import { updateSafeRolloutTimeSeries } from "back-end/src/services/safeRolloutTimeSeries";
import {
  getSafeRolloutAnalysisSummary,
  notifySafeRolloutChange,
} from "back-end/src/services/safeRolloutSnapshots";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  checkAndRollbackSafeRollout,
  updateRampUpSchedule,
} from "back-end/src/enterprise/saferollouts/safeRolloutUtils";
import { MakeModelClass } from "./BaseModel";

const BaseClass = MakeModelClass({
  schema: safeRolloutSnapshotInterface,
  collectionName: "saferolloutsnapshots",
  idPrefix: "srsnp_",
  globallyUniqueIds: true,
});

export class SafeRolloutSnapshotModel extends BaseClass {
  // TODO: fix permissions
  protected canCreate() {
    return true;
  }
  protected canRead(doc: SafeRolloutSnapshotInterface) {
    const { datasource } = this.getForeignRefs(doc);

    return this.context.permissions.canReadMultiProjectResource(
      datasource?.projects,
    );
  }
  protected canUpdate() {
    return true;
  }
  protected canDelete() {
    return true;
  }

  public async getSnapshotForSafeRollout({
    safeRolloutId,
    dimension,
    beforeSnapshot,
    withResults = true,
  }: {
    safeRolloutId: string;
    dimension?: string;
    beforeSnapshot?: SafeRolloutSnapshotInterface;
    withResults?: boolean;
  }): Promise<SafeRolloutSnapshotInterface | undefined> {
    const query: FilterQuery<SafeRolloutSnapshotInterface> = {
      safeRolloutId,
      dimension: dimension || null,
    };

    const all = await super._find(
      {
        ...query,
        status: {
          $in: withResults ? ["success"] : ["success", "running", "error"],
        },
        ...(beforeSnapshot
          ? { dateCreated: { $lt: beforeSnapshot.dateCreated } }
          : {}),
      },
      {
        sort: { dateCreated: -1 },
        limit: 1,
      },
    );

    if (all[0]) {
      return all[0];
    }
  }

  protected async afterUpdate(
    _existingDoc: SafeRolloutSnapshotInterface,
    _updates: Partial<SafeRolloutSnapshotInterface>,
    updatedDoc: SafeRolloutSnapshotInterface,
  ) {
    const latestSafeRolloutSnapshot = await this.getSnapshotForSafeRollout({
      safeRolloutId: updatedDoc.safeRolloutId,
      withResults: false,
    });

    // Ensure we only update the summary for the latest snapshot (or the new if it's the first one)
    const isLatestSnapshot =
      latestSafeRolloutSnapshot === null ||
      latestSafeRolloutSnapshot?.id === updatedDoc.id;

    if (isLatestSnapshot && updatedDoc.status === "success") {
      const safeRollout = await this.context.models.safeRollout.getById(
        updatedDoc.safeRolloutId,
      );
      if (!safeRollout) {
        throw new Error("Safe rollout not found");
      }

      const safeRolloutAnalysisSummary = await getSafeRolloutAnalysisSummary({
        context: this.context,
        safeRollout,
        safeRolloutSnapshot: updatedDoc,
      });

      const updatedSafeRollout =
        await this.context.models.safeRollout.updateById(safeRollout.id, {
          analysisSummary: safeRolloutAnalysisSummary,
        });

      const notificationTriggered = await notifySafeRolloutChange({
        context: this.context,
        updatedSafeRollout,
        safeRolloutSnapshot: updatedDoc,
      });

      try {
        await updateSafeRolloutTimeSeries({
          context: this.context,
          safeRollout: updatedSafeRollout,
          safeRolloutSnapshot: updatedDoc,
          notificationTriggered,
        });
      } catch (e) {
        this.context.logger.error(
          { err: e, safeRolloutId: safeRollout.id, snapshotId: updatedDoc.id },
          "Failed to update Safe Rollout time series data",
        );
      }

      const feature = await getFeature(this.context, safeRollout.featureId);
      if (!feature) {
        throw new Error("Feature not found");
      }
      const environment = feature.environmentSettings[safeRollout.environment];
      if (!environment) {
        throw new Error("Environment not found");
      }
      const ruleIndex = environment.rules.findIndex(
        (r) => r.type === "safe-rollout" && r.safeRolloutId === safeRollout.id,
      );
      if (ruleIndex === -1) {
        throw new Error("Rule not found");
      }

      const status = await checkAndRollbackSafeRollout({
        context: this.context,
        updatedSafeRollout,
        safeRolloutSnapshot: updatedDoc,
        ruleIndex,
        feature,
      });
      // update the ramp up Schedule if the status is running and the ramp up is enabled and not completed
      if (status === "running") {
        await updateRampUpSchedule({
          context: this.context,
          safeRollout,
        });
      }
    }
  }
}
