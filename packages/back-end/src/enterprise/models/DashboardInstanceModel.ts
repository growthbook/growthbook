import mongoose from "mongoose";
import { createDashboardBlocksFromTemplate } from "shared/enterprise";
import {
  dashboardInstanceInterface,
  DashboardInstanceInterface,
} from "back-end/src/enterprise/validators/dashboard-instance";
import { MakeModelClass, UpdateProps } from "back-end/src/models/BaseModel";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { DashboardTemplateInterface } from "back-end/src/enterprise/validators/dashboard-template";
import {
  toInterface as blockToInterface,
  createDashboardBlock,
} from "./DashboardBlockModel";

const DEFAULT_DASHBOARD_BLOCKS: DashboardTemplateInterface["blockInitialValues"] = [
  { type: "metadata-description" },
  { type: "traffic-graph" },
  {
    type: "metric",
    columnsFilter: ["Variation Names", "Chance to Win", "CI Graph", "Lift"],
  },
  { type: "time-series" },
];

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
  additionalIndexes: [
    { fields: { organization: 1, experimentId: 1 }, unique: false },
  ],
});

export const toInterface: ToInterface<DashboardInstanceInterface> = (doc) => {
  const dashboard = removeMongooseFields(doc);
  dashboard.blocks = dashboard.blocks.map(blockToInterface);
  return dashboard;
};

export class DashboardInstanceModel extends BaseClass {
  public async findByExperiment(
    experimentId: string
  ): Promise<DashboardInstanceInterface[]> {
    const dashboards = await this._find({ experimentId });
    if (!dashboards.find((dash) => dash.isDefault)) {
      dashboards.push(await this.createDefaultDashboard(experimentId));
    }
    return dashboards.filter((dash) => !dash.isDeleted);
  }

  protected canCreate(doc: DashboardInstanceInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return true;
    return this.context.permissions.canCreateReport(experiment);
  }

  protected canRead(_doc: DashboardInstanceInterface): boolean {
    return this.context.hasPermission("readData", "");
  }

  protected canUpdate(
    existing: DashboardInstanceInterface,
    updates: UpdateProps<DashboardInstanceInterface>
  ): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");

    const isOwner = this.context.userId === existing.userId;
    const isAdmin = this.context.permissions.canSuperDeleteReport();

    const canManage = isOwner || isAdmin;
    if (canManage) return true;
    if (
      "title" in updates ||
      "editLevel" in updates ||
      "enableAutoUpdates" in updates
    ) {
      return false;
    }

    if (existing.editLevel !== "organization") return false;
    const { experiment } = this.getForeignRefs(existing);
    if (!experiment) return true;
    return this.context.permissions.canUpdateReport(experiment);
  }

  protected canDelete(doc: DashboardInstanceInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");

    const isOwner = this.context.userId === doc.userId;
    const isAdmin = this.context.permissions.canSuperDeleteReport();
    if (!isOwner && !isAdmin) return false;
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return true;
    return this.context.permissions.canDeleteReport(experiment);
  }

  protected migrate(doc: unknown) {
    return toInterface(doc as DashboardInstanceDocument);
  }

  protected async afterCreate(doc: DashboardInstanceDocument) {
    const queryIdSet = getSavedQueryIds(doc);
    for (const queryId of queryIdSet) {
      await this.linkSavedQuery(queryId, doc);
    }
  }

  protected async afterUpdate(
    existing: DashboardInstanceDocument,
    _updates: UpdateProps<DashboardInstanceDocument>,
    newDoc: DashboardInstanceDocument
  ) {
    const initialQueryIdSet = getSavedQueryIds(existing);
    const finalQueryIdSet = getSavedQueryIds(newDoc);
    for (const queryId of initialQueryIdSet) {
      if (finalQueryIdSet.has(queryId)) continue;
      await this.unlinkSavedQuery(queryId, newDoc);
    }
    for (const queryId of finalQueryIdSet) {
      if (initialQueryIdSet.has(queryId)) continue;
      await this.linkSavedQuery(queryId, newDoc);
    }
  }

  protected async afterDelete(doc: DashboardInstanceDocument) {
    const queryIdSet = getSavedQueryIds(doc);
    for (const queryId of queryIdSet) {
      await this.unlinkSavedQuery(queryId, doc);
    }
  }

  protected async linkSavedQuery(
    queryId: string,
    doc: DashboardInstanceDocument
  ) {
    const savedQuery = await this.context.models.savedQueries.getById(queryId);
    if (savedQuery) {
      const linkedDashboards = savedQuery.linkedDashboards || [];
      if (!linkedDashboards.includes(doc.id)) {
        linkedDashboards.push(doc.id);
        await this.context.models.savedQueries.updateById(queryId, {
          linkedDashboards,
        });
      }
    }
  }

  protected async unlinkSavedQuery(
    queryId: string,
    doc: DashboardInstanceDocument
  ) {
    const savedQuery = await this.context.models.savedQueries.getById(queryId);
    if (savedQuery) {
      if ((savedQuery.linkedDashboards || []).includes(doc.id)) {
        const linkedDashboards = (savedQuery.linkedDashboards || []).filter(
          (dashId) => dashId !== doc.id
        );

        await this.context.models.savedQueries.updateById(queryId, {
          linkedDashboards,
        });
      }
    }
  }

  public async deleteById(id: string) {
    const existing = await this.getById(id);
    if (!existing) return;
    // Soft-delete the default dashboard to prevent it from being re-created
    if (existing.isDefault) {
      await this.updateById(id, { isDeleted: true });
    } else {
      await this._deleteOne(existing);
    }
    return existing;
  }

  protected async createDefaultDashboard(experimentId: string) {
    const experiment = await getExperimentById(this.context, experimentId);
    if (!experiment) throw new Error("Cannot find specified experiment");
    const blocksToCreate = createDashboardBlocksFromTemplate(
      { blockInitialValues: DEFAULT_DASHBOARD_BLOCKS },
      experiment
    );
    const blocks = await Promise.all(
      blocksToCreate.map((blockData) =>
        createDashboardBlock(this.context.org.id, blockData)
      )
    );
    return this._createOne({
      experimentId,
      isDefault: true,
      isDeleted: false,
      userId: "",
      editLevel: "organization",
      enableAutoUpdates: true,
      title: "Default Dashboard",
      blocks,
    });
  }
}

function getSavedQueryIds(doc: DashboardInstanceDocument): Set<string> {
  const queryIdSet = new Set<string>();
  doc.blocks.forEach((block) => {
    if (block.type === "sql-explorer" && block.savedQueryId) {
      queryIdSet.add(block.savedQueryId);
    }
  });
  return queryIdSet;
}
