import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  blockHasFieldOfType,
  isPersistedDashboardBlock,
  snapshotSatisfiesBlock,
} from "shared/enterprise";
import { isDefined, isString, stringToBoolean } from "shared/util";
import { groupBy } from "lodash";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import {
  createDashboardBlock,
  migrate,
} from "back-end/src/enterprise/models/DashboardBlockModel";
import { DashboardBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import { createExperimentSnapshot } from "back-end/src/controllers/experiments";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import {
  deleteSnapshotById,
  findSnapshotsByIds,
} from "back-end/src/models/ExperimentSnapshotModel";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { SavedQuery } from "back-end/src/validators/saved-queries";
import { getMetricMap } from "back-end/src/models/MetricModel";
import { getFactTableMap } from "back-end/src/models/FactTableModel";
import { MetricAnalysisInterface } from "back-end/types/metric-analysis";
import {
  updateDashboardMetricAnalyses,
  updateDashboardSavedQueries,
  updateNonExperimentDashboard,
} from "back-end/src/enterprise/services/dashboards";
import { ExperimentInterface } from "back-end/types/experiment";
import { getAdditionalQueryMetadataForExperiment } from "back-end/src/services/experiments";
import { createDashboardBody, updateDashboardBody } from "./dashboards.router";
interface SingleDashboardResponse {
  status: number;
  dashboard: DashboardInterface;
}

interface MultiDashboardResponse {
  status: number;
  dashboards: DashboardInterface[];
}

export async function getAllDashboards(
  req: AuthRequest<never, never, { includeExperimentDashboards?: string }>,
  res: ResponseWithStatusAndError<MultiDashboardResponse>,
) {
  const context = getContextFromReq(req);

  const dashboards = await context.models.dashboards.getAll(
    stringToBoolean(req.query.includeExperimentDashboards)
      ? {}
      : { experimentId: null },
  );
  return res.status(200).json({ status: 200, dashboards });
}

export async function getDashboard(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<SingleDashboardResponse>,
) {
  const context = getContextFromReq(req);

  const dashboard = await context.models.dashboards.getById(req.params.id);
  if (!dashboard)
    return res.status(404).json({
      status: 404,
      message: "Cannot find dashboard",
    });
  return res.status(200).json({ status: 200, dashboard });
}

export async function getDashboardsForExperiment(
  req: AuthRequest<never, { experimentId: string }, never>,
  res: ResponseWithStatusAndError<MultiDashboardResponse>,
) {
  const context = getContextFromReq(req);
  const { experimentId } = req.params;

  const dashboards =
    await context.models.dashboards.findByExperiment(experimentId);
  return res.status(200).json({ status: 200, dashboards });
}

export async function createDashboard(
  req: AuthRequest<z.infer<typeof createDashboardBody>, never, never>,
  res: ResponseWithStatusAndError<SingleDashboardResponse>,
) {
  const context = getContextFromReq(req);

  const {
    experimentId,
    editLevel,
    shareLevel,
    enableAutoUpdates,
    updateSchedule,
    title,
    blocks,
    projects,
  } = req.body;

  if (experimentId) {
    // Quick permission check before we write to the dashboard block collection
    if (!context.hasPremiumFeature("dashboards")) {
      throw new Error("Your plan does not support creating dashboards.");
    }
    const experiment = await getExperimentById(context, experimentId);
    if (!experiment) throw new Error("Cannot find experiment");
    if (!context.permissions.canCreateReport(experiment)) {
      context.permissions.throwPermissionError();
    }
    if (updateSchedule) {
      throw new Error(
        "Cannot specify an update schedule for experiment dashboards",
      );
    }
  } else {
    if (shareLevel === "private") {
      if (!context.hasPremiumFeature("product-analytics-dashboards")) {
        throw new Error(
          "Your plan does not support creating private dashboards.",
        );
      }
    } else {
      if (!context.hasPremiumFeature("share-product-analytics-dashboards")) {
        throw new Error(
          "Your plan does not support creating shared dashboards.",
        );
      }

      if (!context.permissions.canCreateGeneralDashboards(req.body)) {
        context.permissions.throwPermissionError();
      }
    }
    if (enableAutoUpdates && !updateSchedule) {
      throw new Error("Must define an update schedule to enable auto updates");
    }
  }
  const createdBlocks = await Promise.all(
    blocks.map((blockData) => createDashboardBlock(context.org.id, blockData)),
  );

  const dashboard = await context.models.dashboards.create({
    uid: uuidv4().replace(/-/g, ""), // TODO: Move to BaseModel
    isDefault: false,
    isDeleted: false,
    userId: context.userId,
    editLevel,
    shareLevel,
    enableAutoUpdates,
    updateSchedule,
    experimentId: experimentId || undefined,
    title,
    projects,
    blocks: createdBlocks,
  });

  res.status(200).json({
    status: 200,
    dashboard,
  });
}

export async function updateDashboard(
  req: AuthRequest<z.infer<typeof updateDashboardBody>, { id: string }, never>,
  res: ResponseWithStatusAndError<SingleDashboardResponse>,
) {
  const context = getContextFromReq(req);

  const { id } = req.params;
  const updates = { ...req.body };
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) throw new Error("Cannot find dashboard");

  let experiment: ExperimentInterface | null = null;

  if (dashboard.experimentId) {
    experiment = await getExperimentById(context, dashboard.experimentId);
    if (!experiment) throw new Error("Cannot find connected experiment");
  }

  if (updates.blocks) {
    // Quick permission check before we write to the block collection
    if (experiment) {
      if (!context.hasPremiumFeature("dashboards")) {
        throw new Error("Your plan does not support updating dashboards.");
      }
      if (!context.permissions.canUpdateReport(experiment)) {
        context.permissions.throwPermissionError();
      }
    } else {
      if (
        dashboard.editLevel === "private" ||
        updates.editLevel === "private"
      ) {
        if (!context.hasPremiumFeature("product-analytics-dashboards")) {
          throw new Error(
            "Your plan does not support updating private dashboards.",
          );
        }
      }
    }
    const migratedBlocks = updates.blocks.map((block) => migrate(block));
    const createdBlocks = await Promise.all(
      migratedBlocks.map((blockData) =>
        isPersistedDashboardBlock(blockData)
          ? blockData
          : createDashboardBlock(context.org.id, blockData),
      ),
    );
    updates.blocks = createdBlocks;
  }

  const updatedDashboard = await context.models.dashboards.updateById(
    id,
    updates as Partial<DashboardInterface>,
  );

  res.status(200).json({
    status: 200,
    dashboard: updatedDashboard,
  });
}

export async function deleteDashboard(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  await context.models.dashboards.deleteById(id);
  return res.status(200).json({ status: 200 });
}

export async function refreshDashboardData(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) throw new Error("Cannot find dashboard");
  if (dashboard.experimentId) {
    // MKTODO: Validate this change doesn't have any unintended consequences
    const experiment = await getExperimentById(context, dashboard.experimentId);
    if (!experiment)
      throw new Error("Cannot update dashboard without an attached experiment");

    const datasource = await getDataSourceById(context, experiment.datasource);
    if (!datasource) throw new Error("Failed to find connected datasource");

    const { snapshot: mainSnapshot, queryRunner } =
      await createExperimentSnapshot({
        context,
        experiment,
        dimension: undefined,
        datasource,
        phase: experiment.phases.length - 1,
        useCache: true,
        triggeredBy: "manual-dashboard",
        type: "standard",
        preventStartingAnalysis: true,
      });

    let mainSnapshotUsed = false;
    // Copy the blocks of the dashboard to overwrite their snapshot IDs
    const newBlocks = dashboard.blocks.map((block) => {
      if (!blockHasFieldOfType(block, "snapshotId", isString)) return block;
      if (!snapshotSatisfiesBlock(mainSnapshot, block)) return { ...block };
      mainSnapshotUsed = true;
      return { ...block, snapshotId: mainSnapshot.id };
    });
    if (mainSnapshotUsed) {
      await queryRunner.startAnalysis({
        snapshotType: "standard",
        snapshotSettings: mainSnapshot.settings,
        variationNames: experiment.variations.map((v) => v.name),
        metricMap: await getMetricMap(context),
        queryParentId: mainSnapshot.id,
        experimentId: experiment.id,
        factTableMap: await getFactTableMap(context),
        experimentQueryMetadata:
          getAdditionalQueryMetadataForExperiment(experiment),
        fullRefresh: false,
        incrementalRefreshStartTime: new Date(),
      });
    } else {
      await deleteSnapshotById(context.org.id, mainSnapshot.id);
    }

    const dimensionBlockPairs = dashboard.blocks
      .map<[string, string] | undefined>((block) => {
        if (
          blockHasFieldOfType(block, "dimensionId", isString) &&
          !snapshotSatisfiesBlock(mainSnapshot, block)
        ) {
          return [block.dimensionId, block.id];
        }
        return undefined;
      })
      .filter(isDefined);

    // Create a map from dimension -> list of block IDs that use that dimension
    const dimensionsByBlocks = Object.fromEntries(
      Object.entries(
        groupBy(dimensionBlockPairs, ([dimensionId, _blockId]) => dimensionId),
      ).map(([dimensionId, dimBlockPairs]) => [
        dimensionId,
        dimBlockPairs.map(([_dim, blockId]) => blockId),
      ]),
    );

    for (const [dimensionId, blockIds] of Object.entries(dimensionsByBlocks)) {
      const { snapshot } = await createExperimentSnapshot({
        context,
        experiment,
        dimension: dimensionId,
        datasource,
        phase: experiment.phases.length - 1,
        useCache: false,
        triggeredBy: "manual-dashboard",
        type: "exploratory",
      });
      newBlocks.forEach((block) => {
        if (blockIds.includes(block.id)) {
          block.snapshotId = snapshot.id;
        }
      });
    }

    await updateDashboardMetricAnalyses(context, newBlocks);
    await updateDashboardSavedQueries(context, newBlocks);

    // Bypassing permissions here to allow anyone to refresh the results of a dashboard
    await context.models.dashboards.dangerousUpdateBypassPermission(dashboard, {
      blocks: newBlocks,
    });
  } else {
    await updateNonExperimentDashboard(context, dashboard);
  }

  return res.status(200).json({ status: 200 });
}

export async function getDashboardSnapshots(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<{
    snapshots: ExperimentSnapshotInterface[];
    savedQueries: SavedQuery[];
    metricAnalyses: MetricAnalysisInterface[];
  }>,
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) throw new Error("Cannot find dashboard");
  let snapshots: ExperimentSnapshotInterface[] = [];
  if (dashboard.experimentId) {
    const experiment = await getExperimentById(context, dashboard.experimentId);
    const snapshotIds = [
      ...new Set([
        experiment?.analysisSummary?.snapshotId,
        ...dashboard.blocks.map((block) => block.snapshotId),
      ]),
    ].filter(
      (snapId): snapId is string => isDefined(snapId) && snapId.length > 0,
    );
    snapshots = await findSnapshotsByIds(context, snapshotIds);
  } else {
    snapshots = [];
  }
  const savedQueries = await context.models.savedQueries.getByIds([
    ...new Set(
      dashboard.blocks
        .filter(
          (
            block,
          ): block is Extract<
            DashboardBlockInterface,
            { savedQueryId: string }
          > =>
            blockHasFieldOfType(block, "savedQueryId", isString) &&
            block.savedQueryId.length > 0,
        )
        .map((block) => block.savedQueryId),
    ),
  ]);
  const metricAnalyses = await context.models.metricAnalysis.getByIds([
    ...new Set(
      dashboard.blocks
        .filter(
          (
            block,
          ): block is Extract<
            DashboardBlockInterface,
            { metricAnalysisId: string }
          > =>
            blockHasFieldOfType(block, "metricAnalysisId", isString) &&
            block.metricAnalysisId.length > 0,
        )
        .map((block) => block.metricAnalysisId),
    ),
  ]);
  return res
    .status(200)
    .json({ status: 200, snapshots, savedQueries, metricAnalyses });
}
