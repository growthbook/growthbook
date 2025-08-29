import mongoose from "mongoose";
import {
  dashboardInterface,
  DashboardInterface,
} from "back-end/src/enterprise/validators/dashboard";
import { MakeModelClass, UpdateProps } from "back-end/src/models/BaseModel";
import {
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import { LegacyDashboardBlockInterface } from "../validators/dashboard-block";
import {
  toInterface as blockToInterface,
  migrate as migrateBlock,
} from "./DashboardBlockModel";

export type DashboardDocument = mongoose.Document & DashboardInterface;
type LegacyDashboardDocument = Omit<DashboardDocument, "blocks"> & {
  blocks: LegacyDashboardBlockInterface[];
};

const BaseClass = MakeModelClass({
  schema: dashboardInterface,
  collectionName: "dashboards",
  idPrefix: "dash_",
  auditLog: {
    entity: "dashboard",
    createEvent: "dashboard.create",
    updateEvent: "dashboard.update",
    deleteEvent: "dashboard.delete",
  },
  globallyUniqueIds: true,
  additionalIndexes: [
    { fields: { organization: 1, experimentId: 1 }, unique: false },
  ],
});

export const toInterface: ToInterface<DashboardInterface> = (doc) => {
  const dashboard = removeMongooseFields(doc);
  dashboard.blocks = dashboard.blocks.map(blockToInterface);
  return dashboard;
};

export class DashboardModel extends BaseClass {
  public async findByExperiment(
    experimentId: string,
  ): Promise<DashboardInterface[]> {
    return this._find({ experimentId, isDeleted: false, isDefault: false });
  }

  protected canCreate(doc: DashboardInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return true;
    return this.context.permissions.canCreateReport(experiment);
  }

  protected canRead(_doc: DashboardInterface): boolean {
    return this.context.hasPermission("readData", "");
  }

  protected canUpdate(
    existing: DashboardInterface,
    updates: UpdateProps<DashboardInterface>,
  ): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");

    const isOwner = this.context.userId === existing.userId;
    const isAdmin = this.context.permissions.canSuperDeleteReport();

    const canManage = isOwner || isAdmin;
    if (canManage) return true;
    // Editing privileged fields (metadata/settings) requires canManage
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

  protected canDelete(doc: DashboardInterface): boolean {
    if (!this.context.hasPremiumFeature("dashboards"))
      throw new Error("Must have a commercial License Key to use Dashboards");

    const isOwner = this.context.userId === doc.userId;
    const isAdmin = this.context.permissions.canSuperDeleteReport();
    if (!isOwner && !isAdmin) return false;
    const { experiment } = this.getForeignRefs(doc);
    if (!experiment) return true;
    return this.context.permissions.canDeleteReport(experiment);
  }

  protected migrate(orig: LegacyDashboardDocument): DashboardInterface {
    return toInterface({
      ...orig,
      blocks: orig.blocks.map(migrateBlock),
    });
  }

  protected async afterCreate(doc: DashboardDocument) {
    const queryIdSet = getSavedQueryIds(doc);
    for (const queryId of queryIdSet) {
      await this.linkSavedQuery(queryId, doc);
    }
  }

  protected async afterUpdate(
    existing: DashboardDocument,
    _updates: UpdateProps<DashboardDocument>,
    newDoc: DashboardDocument,
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

  protected async afterDelete(doc: DashboardDocument) {
    const queryIdSet = getSavedQueryIds(doc);
    for (const queryId of queryIdSet) {
      await this.unlinkSavedQuery(queryId, doc);
    }
  }

  protected async linkSavedQuery(queryId: string, doc: DashboardDocument) {
    const savedQuery = await this.context.models.savedQueries.getById(queryId);
    if (savedQuery) {
      const linkedDashboardIds = savedQuery.linkedDashboardIds || [];
      if (!linkedDashboardIds.includes(doc.id)) {
        linkedDashboardIds.push(doc.id);
        await this.context.models.savedQueries.updateById(queryId, {
          linkedDashboardIds,
        });
      }
    }
  }

  protected async unlinkSavedQuery(queryId: string, doc: DashboardDocument) {
    const savedQuery = await this.context.models.savedQueries.getById(queryId);
    if (savedQuery) {
      if ((savedQuery.linkedDashboardIds || []).includes(doc.id)) {
        const linkedDashboardIds = (savedQuery.linkedDashboardIds || []).filter(
          (dashId) => dashId !== doc.id,
        );

        await this.context.models.savedQueries.updateById(queryId, {
          linkedDashboardIds,
        });
      }
    }
  }

  public async deleteById(id: string) {
    const existing = await this.getById(id);
    if (!existing) return;
    await this._deleteOne(existing);
    return existing;
  }
}

function getSavedQueryIds(doc: DashboardDocument): Set<string> {
  const queryIdSet = new Set<string>();
  doc.blocks.forEach((block) => {
    if (block.type === "sql-explorer" && block.savedQueryId) {
      queryIdSet.add(block.savedQueryId);
    }
  });
  return queryIdSet;
}
