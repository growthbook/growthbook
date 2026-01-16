import mongoose from "mongoose";
import { v4 as uuidv4 } from "uuid";
import uniqid from "uniqid";
import { UpdateProps } from "shared/types/base-model";
import { isString } from "shared/util";
import {
  ApiCreateDashboardBlockInterface,
  ApiDashboardBlockInterface,
  blockHasFieldOfType,
  dashboardBlockHasIds,
  apiCreateDashboardBody,
  apiDashboardInterface,
  ApiDashboardInterface,
  ApiGetDashboardsForExperimentReturn,
  apiGetDashboardsForExperimentReturn,
  apiGetDashboardsForExperimentValidator,
  apiUpdateDashboardBody,
  dashboardInterface,
  DashboardInterface,
  CreateDashboardBlockInterface,
  DashboardBlockInterface,
  LegacyDashboardBlockInterface,
  convertPinnedSlicesToSliceTags,
} from "shared/enterprise";
import omit from "lodash/omit";
import { getValidDate } from "shared/dates";
import {
  MakeModelClass,
  ScopedFilterQuery,
} from "back-end/src/models/BaseModel";
import {
  getCollection,
  removeMongooseFields,
  ToInterface,
} from "back-end/src/util/mongo.util";
import { defineCustomApiHandler } from "back-end/src/api/apiModelHandlers";

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
  apiConfig: {
    modelKey: "dashboards",
    modelSingular: "dashboard",
    modelPlural: "dashboards",
    apiInterface: apiDashboardInterface,
    schemas: {
      createBody: apiCreateDashboardBody,
      updateBody: apiUpdateDashboardBody,
    },
    pathBase: "/dashboards",
    includeDefaultCrud: true,
    customHandlers: [
      defineCustomApiHandler({
        pathFragment: "/by-experiment/:experimentId",
        verb: "get",
        operationId: "getDashboardsForExperiment",
        validator: apiGetDashboardsForExperimentValidator,
        zodReturnObject: apiGetDashboardsForExperimentReturn,
        summary: "Get all dashboards for an experiment",
        reqHandler: async (
          req,
        ): Promise<ApiGetDashboardsForExperimentReturn> => ({
          dashboards: (
            await req.context.models.dashboards.findByExperiment(
              req.params.experimentId,
            )
          ).map(req.context.models.dashboards.toApiInterface),
        }),
      }),
    ],
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

  protected async customValidation(toSave: DashboardDocument) {
    if (toSave.experimentId) {
      if (toSave.updateSchedule) {
        throw new Error(
          "Cannot specify an update schedule for experiment dashboards",
        );
      }
    } else {
      if (toSave.enableAutoUpdates && !toSave.updateSchedule) {
        throw new Error(
          "Must define an update schedule to enable auto updates",
        );
      }
    }
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
          linkedDashboardIds: _l,
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

  public toApiInterface(dashboard: DashboardInterface): ApiDashboardInterface {
    return {
      ...removeMongooseFields(dashboard),
      blocks: dashboard.blocks.map(toBlockApiInterface),
      dateCreated: dashboard.dateCreated.toISOString(),
      dateUpdated: dashboard.dateUpdated.toISOString(),
      nextUpdate: dashboard.nextUpdate?.toISOString(),
      lastUpdated: dashboard.lastUpdated?.toISOString(),
    };
  }

  protected async processApiCreateBody(rawBody: unknown) {
    const {
      editLevel,
      shareLevel,
      enableAutoUpdates,
      updateSchedule,
      experimentId,
      title,
      projects,
      blocks,
    } = apiCreateDashboardBody.parse(rawBody);
    const createdBlocks = await Promise.all(
      blocks.map((blockData) =>
        generateDashboardBlockIds(
          this.context.org.id,
          fromBlockApiInterface(blockData),
        ),
      ),
    );
    return {
      uid: uuidv4().replace(/-/g, ""), // TODO: Move to BaseModel
      isDefault: false,
      isDeleted: false,
      userId: this.context.userId,
      editLevel,
      shareLevel,
      enableAutoUpdates,
      updateSchedule,
      experimentId: experimentId || undefined,
      title,
      projects,
      blocks: createdBlocks,
    };
  }
  protected async processApiUpdateBody(rawBody: unknown) {
    const { blocks: blockUpdates, ...otherUpdates } =
      apiUpdateDashboardBody.parse(rawBody);
    const updates: UpdateProps<DashboardInterface> = otherUpdates;
    if (blockUpdates) {
      const migratedBlocks = blockUpdates
        .map(fromBlockApiInterface)
        .map(migrateBlock);
      const createdBlocks = await Promise.all(
        migratedBlocks.map((blockData) =>
          dashboardBlockHasIds(blockData)
            ? blockData
            : generateDashboardBlockIds(this.context.org.id, blockData),
        ),
      );
      updates.blocks = createdBlocks;
    }
    return updates;
  }
}

function getSavedQueryIds(doc: DashboardDocument): Set<string> {
  const queryIdSet = new Set<string>();
  doc.blocks.forEach((block) => {
    if (
      blockHasFieldOfType(block, "savedQueryId", isString) &&
      block.savedQueryId
    ) {
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
    case "experiment-metric": {
      // Check if this is a legacy block with metricSelector
      const legacyDoc = doc as LegacyDashboardBlockInterface;
      const metricSelector =
        ("metricSelector" in legacyDoc ? legacyDoc.metricSelector : "custom") ??
        "custom";

      // Convert metricSelector to metricIds
      const existingMetricIds = doc.metricIds ?? [];
      const migratedMetricIds = [...existingMetricIds];
      // Add selector ID to metricIds if it's not "custom"
      if (metricSelector !== "custom") {
        if (!migratedMetricIds.includes(metricSelector)) {
          migratedMetricIds.unshift(metricSelector);
        }
      }

      const sortByRaw =
        "sortBy" in doc && typeof doc.sortBy === "string"
          ? (doc.sortBy as string)
          : null;
      // Map legacy "custom" to "metrics", otherwise use the value if it's valid
      const sortBy =
        sortByRaw === "custom"
          ? "metrics"
          : sortByRaw === "metrics" ||
              sortByRaw === "significance" ||
              sortByRaw === "change"
            ? sortByRaw
            : null;
      const sortDirection =
        "sortDirection" in doc && typeof doc.sortDirection === "string"
          ? doc.sortDirection
          : null;
      const pinnedSlices =
        "pinnedMetricSlices" in doc && Array.isArray(doc.pinnedMetricSlices)
          ? doc.pinnedMetricSlices
          : [];
      const sliceTagsFilter =
        pinnedSlices.length > 0
          ? convertPinnedSlicesToSliceTags(pinnedSlices)
          : doc.sliceTagsFilter || [];
      const metricTagFilter = doc.metricTagFilter || [];
      return {
        ...omit(doc, ["pinnedMetricSlices", "pinSource", "metricSelector"]),
        metricIds: migratedMetricIds,
        sliceTagsFilter,
        metricTagFilter,
        sortBy,
        sortDirection,
      } as DashboardBlockInterface | CreateDashboardBlockInterface;
    }
    case "experiment-dimension": {
      // Check if this is a legacy block with metricSelector
      const legacyDoc = doc as LegacyDashboardBlockInterface;
      const dimensionMetricSelector =
        ("metricSelector" in legacyDoc ? legacyDoc.metricSelector : "custom") ??
        "custom";

      // Convert metricSelector to metricIds
      const existingMetricIds = doc.metricIds ?? [];
      const migratedMetricIds = [...existingMetricIds];
      // Add selector ID to metricIds if it's not "custom"
      if (dimensionMetricSelector !== "custom") {
        if (!migratedMetricIds.includes(dimensionMetricSelector)) {
          migratedMetricIds.unshift(dimensionMetricSelector);
        }
      }

      const metricTagFilter = doc.metricTagFilter || [];
      const sortByRaw =
        "sortBy" in doc && typeof doc.sortBy === "string"
          ? (doc.sortBy as string)
          : null;
      // Map legacy "custom" to "metrics", otherwise use the value if it's valid
      const sortBy =
        sortByRaw === "custom"
          ? "metrics"
          : sortByRaw === "metrics" ||
              sortByRaw === "significance" ||
              sortByRaw === "change"
            ? sortByRaw
            : null;
      const sortDirection =
        "sortDirection" in doc && typeof doc.sortDirection === "string"
          ? doc.sortDirection
          : null;
      return {
        ...omit(doc, ["pinnedMetricSlices", "pinSource", "metricSelector"]),
        metricIds: migratedMetricIds,
        metricTagFilter,
        sortBy,
        sortDirection,
      } as DashboardBlockInterface | CreateDashboardBlockInterface;
    }
    case "experiment-time-series": {
      // Check if this is a legacy block with metricSelector
      const legacyDoc = doc as LegacyDashboardBlockInterface;
      const timeSeriesMetricSelector =
        ("metricSelector" in legacyDoc ? legacyDoc.metricSelector : "custom") ??
        "custom";

      // Convert metricSelector to metricIds
      const existingMetricIds = doc.metricId
        ? [doc.metricId]
        : (doc.metricIds ?? []);
      const migratedMetricIds = [...existingMetricIds];
      // Add selector ID to metricIds if it's not "custom"
      if (timeSeriesMetricSelector !== "custom") {
        if (!migratedMetricIds.includes(timeSeriesMetricSelector)) {
          migratedMetricIds.unshift(timeSeriesMetricSelector);
        }
      }

      const sortByRaw =
        "sortBy" in doc && typeof doc.sortBy === "string"
          ? (doc.sortBy as string)
          : null;
      // Map legacy "custom" to "metrics", otherwise use the value if it's valid
      const sortBy =
        sortByRaw === "custom"
          ? "metrics"
          : sortByRaw === "metrics" ||
              sortByRaw === "significance" ||
              sortByRaw === "change"
            ? sortByRaw
            : null;
      const sortDirection =
        "sortDirection" in doc && typeof doc.sortDirection === "string"
          ? doc.sortDirection
          : null;
      const pinnedSlices =
        "pinnedMetricSlices" in doc && Array.isArray(doc.pinnedMetricSlices)
          ? doc.pinnedMetricSlices
          : [];
      const sliceTagsFilter =
        pinnedSlices.length > 0
          ? convertPinnedSlicesToSliceTags(pinnedSlices)
          : doc.sliceTagsFilter || [];
      const metricTagFilter = doc.metricTagFilter || [];
      return {
        ...omit(doc, [
          "pinnedMetricSlices",
          "pinSource",
          "metricId",
          "metricSelector",
        ]),
        metricIds: migratedMetricIds,
        sliceTagsFilter,
        metricTagFilter,
        sortBy,
        sortDirection,
      } as DashboardBlockInterface | CreateDashboardBlockInterface;
    }
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

function toBlockApiInterface(
  block: DashboardBlockInterface,
): ApiDashboardBlockInterface {
  switch (block.type) {
    case "metric-explorer":
      return {
        ...block,
        analysisSettings: {
          ...block.analysisSettings,
          startDate: getValidDate(
            block.analysisSettings.startDate,
          ).toISOString(),
          endDate: getValidDate(block.analysisSettings.endDate).toISOString(),
        },
      };
    default:
      return block;
  }
}

export function fromBlockApiInterface(
  apiBlock: ApiDashboardBlockInterface | ApiCreateDashboardBlockInterface,
): DashboardBlockInterface | CreateDashboardBlockInterface {
  switch (apiBlock.type) {
    case "metric-explorer":
      return {
        ...apiBlock,
        analysisSettings: {
          ...apiBlock.analysisSettings,
          startDate: getValidDate(apiBlock.analysisSettings.startDate),
          endDate: getValidDate(apiBlock.analysisSettings.endDate),
        },
      };
    case "sql-explorer":
      return {
        ...apiBlock,
        blockConfig: apiBlock.blockConfig ?? [],
      };
    default:
      return apiBlock;
  }
}
