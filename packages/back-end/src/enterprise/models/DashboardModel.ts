import mongoose from "mongoose";
import {
  dashboardInterface,
  DashboardInterface,
} from "back-end/src/enterprise/validators/dashboard";
import {
  MakeModelClass,
  ScopedFilterQuery,
  UpdateProps,
} from "back-end/src/models/BaseModel";
import {
  getCollection,
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

const COLLECTION_NAME = "dashboards";
const BaseClass = MakeModelClass({
  schema: dashboardInterface,
  collectionName: COLLECTION_NAME,
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
  baseQuery: {
    isDefault: false,
    isDeleted: false,
  },
});

export const toInterface: ToInterface<DashboardInterface> = (doc) => {
  const dashboard = removeMongooseFields(doc);
  dashboard.blocks = dashboard.blocks.map(blockToInterface);
  return dashboard;
};

export class DashboardModel extends BaseClass {
  public async findByExperiment(
    experimentId: string,
    additionalFilter: ScopedFilterQuery<typeof dashboardInterface> = {},
  ): Promise<DashboardInterface[]> {
    return this._find({ experimentId, ...additionalFilter });
  }

  public static async getDashboardsToUpdate(): Promise<
    Array<{
      id: string;
      organization: string;
    }>
  > {
    const dashboards = await getCollection(COLLECTION_NAME)
      .find({
        isDeleted: false,
        isDefault: false,
        enableAutoUpdates: true,
        experimentId: null,
        $or: [
          {
            nextUpdate: {
              $exists: true,
              $lte: new Date(),
            },
          },
          {
            nextUpdate: {
              $exists: false,
            },
          },
        ],
      })
      .project({
        id: true,
        organization: true,
      })
      .limit(100)
      .sort({ nextUpdate: 1 })
      .toArray();
    return dashboards.map(({ id, organization }) => ({ id, organization }));
  }

  protected canCreate(doc: DashboardInterface): boolean {
    if (doc.experimentId) {
      if (!this.context.hasPremiumFeature("dashboards")) {
        throw new Error("Your plan does not support creating dashboards.");
      }
      const { experiment } = this.getForeignRefs(doc);
      if (!experiment) {
        throw new Error("Experiment not found.");
      }
      return this.context.permissions.canCreateReport(experiment);
    } else {
      if (doc.editLevel === "private") {
        if (!this.context.hasPremiumFeature("product-analytics-dashboards")) {
          throw new Error(
            "Your plan does not support creating private dashboards.",
          );
        }
      } else {
        if (
          !this.context.hasPremiumFeature("share-product-analytics-dashboards")
        ) {
          throw new Error(
            "Your plan does not support creating shared dashboards.",
          );
        }
      }
      return this.context.permissions.canCreateGeneralDashboards(doc);
    }
  }

  protected canRead(doc: DashboardInterface): boolean {
    if (!this.context.permissions.canReadMultiProjectResource(doc.projects)) {
      return false;
    }

    if (doc.shareLevel === "private" && doc.userId !== this.context.userId) {
      return false;
    }

    return true;
  }

  protected canUpdate(
    existing: DashboardInterface,
    updates: UpdateProps<DashboardInterface>,
  ): boolean {
    if (existing.experimentId) {
      if (!this.context.hasPremiumFeature("dashboards")) {
        throw new Error("Your plan does not support updating dashboards.");
      }

      const isOwner = existing.userId === this.context.userId;

      if (!isOwner) {
        if (
          "title" in updates ||
          "editLevel" in updates ||
          "enableAutoUpdates" in updates
        ) {
          return false;
        }
      }

      const { experiment } = this.getForeignRefs(existing);
      if (!experiment) throw new Error("Experiment not found.");

      return this.context.permissions.canUpdateReport(experiment);
    } else {
      if (existing.editLevel === "private" || updates.editLevel === "private") {
        if (!this.context.hasPremiumFeature("product-analytics-dashboards")) {
          throw new Error(
            "Your plan does not support updating private dashboards.",
          );
        }
        // Safety check to prevent updating private dashboards that are not owned by the user
        if (existing.userId !== this.context.userId) {
          throw new Error(
            "You are not authorized to edit this dashboard. This dashboard is private, and you are not the owner.",
          );
        }
      }
      if (
        existing.editLevel === "published" ||
        updates.editLevel === "published"
      ) {
        if (
          !this.context.hasPremiumFeature("share-product-analytics-dashboards")
        ) {
          throw new Error(
            "Your plan does not support updating shared dashboards.",
          );
        }
      }
      return this.context.permissions.canUpdateGeneralDashboards(
        existing,
        updates,
      );
    }
  }

  protected canDelete(doc: DashboardInterface): boolean {
    if (doc.experimentId) {
      const { experiment } = this.getForeignRefs(doc);
      if (!experiment) throw new Error("Experiment not found.");
      return this.context.permissions.canDeleteReport(experiment);
    } else {
      // Safety check to prevent deleting private dashboards that are not owned by the user
      if (doc.editLevel === "private" && doc.userId !== this.context.userId) {
        return false;
      }
      return this.context.permissions.canDeleteGeneralDashboards(doc);
    }
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
    for (const queryId of finalQueryIdSet) {
      if (initialQueryIdSet.has(queryId)) continue;
      await this.linkSavedQuery(queryId, newDoc);
    }
  }

  protected async afterDelete(_doc: DashboardDocument) {}

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
