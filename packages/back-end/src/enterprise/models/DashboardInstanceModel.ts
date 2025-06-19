import mongoose from "mongoose";
import { isMatch } from "lodash";
import { isDimensionBlock } from "shared/enterprise";
import {
  dashboardInstanceInterface,
  DashboardInstanceInterface,
} from "back-end/src/enterprise/validators/dashboard-instance";
import { MakeModelClass } from "back-end/src/models/BaseModel";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import {
  ExperimentSnapshotAnalysisSettings,
  ExperimentSnapshotSettings,
} from "back-end/types/experiment-snapshot";
import { getLatestSnapshot } from "back-end/src/models/ExperimentSnapshotModel";
import { ExperimentInterface } from "back-end/types/experiment";
import {
  dashboardBlockSchema,
  toInterface as blockToInterface,
} from "./DashboardBlockModel";

export const dashboardInstanceSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organizationId: String,
  experimentId: String,
  dateCreated: Date,
  dateUpdated: Date,
  owner: String,
  title: String,
  description: String,
  blocks: [dashboardBlockSchema],
  settings: {
    baselineRow: Number,
    dateStart: Date,
    dateEnd: Date,
    defaultMetricId: String,
    defaultVariationIds: [String],
    defaultDimensionId: String,
    defaultDimensionValues: [String],
  },
});

dashboardInstanceSchema.index({
  organizationId: 1,
  experimentId: 1,
  dateCreated: -1,
});

export type DashboardInstanceDocument = mongoose.Document &
  DashboardInstanceInterface;

const BaseClass = MakeModelClass({
  schema: dashboardInstanceInterface,
  collectionName: "dashboardinstances",
  idPrefix: "dashinst_",
  auditLog: {
    entity: "dashboardInstance",
    createEvent: "dashboardInstance.create",
    updateEvent: "dashboardInstance.update",
    deleteEvent: "dashboardInstance.delete",
  },
  globallyUniqueIds: true,
});

export const toInterface: ToInterface<DashboardInstanceInterface> = (doc) => {
  const dashboard = removeMongooseFields(doc);
  dashboard.blocks = dashboard.blocks.map(blockToInterface);
  return dashboard;
};

export class DashboardInstanceModel extends BaseClass {
  protected canCreate(doc: DashboardInstanceInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error(
        "Must have a commercial License Key to create Dashboards"
      );
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return true;
    return this.context.permissions.canCreateReport(experiment);
  }

  protected canRead(_doc: DashboardInstanceInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error(
        "Must have a commercial License Key to create Dashboards"
      );
    return this.context.hasPermission("readData", "");
  }

  protected canUpdate(
    existing: DashboardInstanceInterface,
    _updates: DashboardInstanceInterface
  ): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error(
        "Must have a commercial License Key to create Dashboards"
      );

    const { experiment } = this.getForeignRefs(existing);
    if (!experiment) return true;
    return this.context.permissions.canUpdateReport(experiment);
  }

  protected canDelete(doc: DashboardInstanceInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error(
        "Must have a commercial License Key to create Dashboards"
      );

    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return true;
    return this.context.permissions.canDeleteReport(experiment);
  }

  protected migrate(doc: unknown) {
    return toInterface(doc as DashboardInstanceDocument);
  }
}

// Merges the individual blocks' overrides with the defaults for the dashboard
// Returns the minimal set of snapshots needed for all the blocks as defined by their settings
// and additional analysis settings
export async function computeSnapshotSettings(
  dashboard: DashboardInstanceInterface,
  experiment: ExperimentInterface
): Promise<
  Array<{
    snapshotSettings: ExperimentSnapshotSettings;
    analysisSettingsList: ExperimentSnapshotAnalysisSettings[];
    blockUids: string[];
  }>
> {
  const snapshot = await getLatestSnapshot({
    experiment: experiment.id,
    phase: experiment.phases.length - 1,
  });
  if (!snapshot) return [];
  const experimentSnapshotSettings = snapshot.settings;
  const experimentAnalysisSettings = snapshot.analyses[0].settings;

  const snapshotInfo: Array<{
    snapshotSettings: ExperimentSnapshotSettings;
    analysisSettingsList: ExperimentSnapshotAnalysisSettings[];
    blockUids: string[];
  }> = [];
  dashboard.blocks.forEach((block) => {
    const blockSnapshotSettings: Partial<ExperimentSnapshotSettings> =
      isDimensionBlock(block) && block.dimensionId
        ? { dimensions: [{ id: block.dimensionId }] }
        : {};
    const blockAnalysisSettings: Partial<ExperimentSnapshotAnalysisSettings> =
      isDimensionBlock(block) && block.dimensionId
        ? {
            dimensions: [block.dimensionId],
          }
        : {};
    const combinedSnapshotSettings = {
      ...experimentSnapshotSettings,
      ...blockSnapshotSettings,
    };
    const combinedAnalysisSettings = {
      ...experimentAnalysisSettings,
      ...blockAnalysisSettings,
    };
    let snapshotRecord = snapshotInfo.find(({ snapshotSettings }) =>
      isMatch(snapshotSettings, combinedSnapshotSettings)
    );
    if (snapshotRecord) {
      if (
        !snapshotRecord.analysisSettingsList.find((analysisSettings) =>
          isMatch(analysisSettings, combinedAnalysisSettings)
        )
      ) {
        snapshotRecord.analysisSettingsList.push(combinedAnalysisSettings);
      }
      snapshotRecord.blockUids.push(block.uid);
    } else {
      snapshotRecord = {
        snapshotSettings: combinedSnapshotSettings,
        analysisSettingsList: [combinedAnalysisSettings],
        blockUids: [block.uid],
      };
      snapshotInfo.push(snapshotRecord);
    }
  });
  return snapshotInfo;
}
