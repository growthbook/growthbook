import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import uniqid from "uniqid";
import { UpdateProps } from "shared/types/base-model";
import { isString } from "shared/util";
import { blockHasFieldOfType } from "shared/enterprise";
import {
  dashboardInterface,
  DashboardInterface,
} from "back-end/src/enterprise/validators/dashboard";
import {
  MakeModelClass,
  ScopedFilterQuery,
} from "back-end/src/models/BaseModel";
import {
  getCollection,
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import {
  CreateDashboardBlockInterface,
  DashboardBlockInterface,
  LegacyDashboardBlockInterface,
} from "../validators/dashboard-block";

export type DashboardDocument = mongoose.Document & DashboardInterface;
type LegacyDashboardDocument = Omit<
  DashboardDocument,
  "blocks" | "editLevel" | "shareLevel"
> & {
  blocks: LegacyDashboardBlockInterface[];
  editLevel: "organization" | "private";
  shareLevel?: DashboardInterface["shareLevel"];
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
    const isOwner = this.context.userId === existing.userId;
    const isAdmin = this.context.permissions.canSuperDeleteReport();
    const canManageOwnerAndSharing = isOwner || isAdmin;

    // Non-owners & non-admins can't update owner or sharing/edit levels for Dashboards
    if (!canManageOwnerAndSharing) {
      if ("userId" in updates && updates.userId !== existing.userId) {
        throw new Error(
          "You are not authorized to change the owner of this dashboard.",
        );
      }
      if ("editLevel" in updates && updates.editLevel !== existing.editLevel) {
        throw new Error(
          "You are not authorized to change the sharing level of this dashboard.",
        );
      }
      if (
        "shareLevel" in updates &&
        updates.shareLevel !== existing.shareLevel
      ) {
        throw new Error(
          "You are not authorized to change the sharing level of this dashboard.",
        );
      }
    }

    if (existing.experimentId) {
      // Check that the org has the commerical feature
      if (!this.context.hasPremiumFeature("dashboards")) {
        throw new Error("Your plan does not support updating dashboards.");
      }

      const { experiment } = this.getForeignRefs(existing);
      if (!experiment) throw new Error("Experiment not found.");

      // Check that the user has permission to update experiment reports
      return this.context.permissions.canUpdateReport(experiment);
    } else {
      if (existing.editLevel === "private" || updates.editLevel === "private") {
        if (!this.context.hasPremiumFeature("product-analytics-dashboards")) {
          throw new Error(
            "Your plan does not support updating private dashboards.",
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
    // A user must have the permission, and be the owner or an admin to delete a dashboard
    const isOwner = this.context.userId === doc.userId;
    const isAdmin = this.context.permissions.canManageOrgSettings();
    if (!isOwner && !isAdmin) {
      return false;
    }
    if (doc.experimentId) {
      const { experiment } = this.getForeignRefs(doc);
      if (!experiment) throw new Error("Experiment not found.");
      return this.context.permissions.canDeleteReport(experiment);
    } else {
      return this.context.permissions.canDeleteGeneralDashboards(doc);
    }
  }

  protected migrate(orig: LegacyDashboardDocument): DashboardInterface {
    return toInterface({
      ...orig,
      blocks: orig.blocks.map(migrateBlock),
      editLevel:
        orig.editLevel === "organization" ? "published" : orig.editLevel,
      shareLevel: orig.shareLevel || "private",
      updateSchedule: orig.updateSchedule || undefined,
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

  // When duplicating a dashboard, we need to create a new instance of each saved query so changes in
  // the new dashboard don't affect the existing one
  protected async beforeCreate(doc: DashboardDocument) {
    const savedQueryIds = new Set(
      doc.blocks
        .filter((block) => blockHasFieldOfType(block, "savedQueryId", isString))
        .map(({ savedQueryId }) => savedQueryId),
    );
    const newIdMapping: Record<string, string> = {};
    for (const oldId of savedQueryIds) {
      const existing = await this.context.models.savedQueries.getById(oldId);
      if (!existing) continue;
      // Only duplicate the query if it's linked to an existing dashboard (i.e. not being created for this new dashboard)
      if ((existing.linkedDashboardIds ?? []).some((dashId) => dashId)) {
        const {
          id: _i,
          organization: _o,
          dateCreated: _c,
          dateUpdated: _u,
          ...toCreate
        } = existing;
        const { id } = await this.context.models.savedQueries.create(toCreate);
        newIdMapping[oldId] = id;
      }
    }
    doc.blocks = doc.blocks.map((block) => {
      if (!blockHasFieldOfType(block, "savedQueryId", isString)) return block;
      return {
        ...block,
        savedQueryId: newIdMapping[block.savedQueryId] ?? block.savedQueryId,
      };
    });
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

export const blockToInterface: ToInterface<DashboardBlockInterface> = (doc) => {
  return removeMongooseFields<DashboardBlockInterface>(doc);
};

export function generateDashboardBlockIds(
  organization: string,
  initialValue: CreateDashboardBlockInterface,
): DashboardBlockInterface {
  const block = {
    ...initialValue,
    organization,
    id: uniqid("dshblk_"),
    uid: uuidv4().replace(/-/g, ""),
  };

  return blockToInterface(block);
}

export function migrateBlock(
  doc:
    | LegacyDashboardBlockInterface
    | DashboardBlockInterface
    | CreateDashboardBlockInterface,
): DashboardBlockInterface | CreateDashboardBlockInterface {
  switch (doc.type) {
    case "experiment-metric":
      return {
        ...doc,
        metricSelector: doc.metricSelector || "custom",
        pinSource: doc.pinSource || "experiment",
        pinnedMetricSlices: doc.pinnedMetricSlices || [],
      };
    case "experiment-dimension":
      return {
        ...doc,
        metricSelector: doc.metricSelector || "custom",
      };
    case "experiment-time-series":
      return {
        ...doc,
        metricIds: doc.metricId ? [doc.metricId] : (doc.metricIds ?? undefined),
        metricId: undefined,
        metricSelector: doc.metricSelector || "custom",
        pinSource: doc.pinSource || "experiment",
        pinnedMetricSlices: doc.pinnedMetricSlices || [],
      };
    case "experiment-description":
      return {
        ...doc,
        type: "experiment-metadata",
        showDescription: true,
        showHypothesis: false,
        showVariationImages: false,
      };
    case "experiment-hypothesis":
      return {
        ...doc,
        type: "experiment-metadata",
        showDescription: false,
        showHypothesis: true,
        showVariationImages: false,
      };
    case "experiment-variation-image":
      return {
        ...doc,
        type: "experiment-metadata",
        showDescription: false,
        showHypothesis: false,
        showVariationImages: true,
      };
    case "experiment-traffic-graph":
      return {
        ...doc,
        type: "experiment-traffic",
        showTable: false,
        showTimeseries: true,
      };
    case "experiment-traffic-table":
      return {
        ...doc,
        type: "experiment-traffic",
        showTable: true,
        showTimeseries: false,
      };
    case "sql-explorer": {
      return {
        ...doc,
        blockConfig: doc.blockConfig ?? [],
      };
    }
    default:
      return doc;
  }
}
