import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  blockHasFieldOfType,
  isPersistedDashboardBlock,
  snapshotSatisfiesBlock,
} from "shared/enterprise";
import { isDefined, isString, stringToBoolean } from "shared/util";
import { groupBy } from "lodash";
import { getValidDate } from "shared/dates";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import { createDashboardBlock } from "back-end/src/enterprise/models/DashboardBlockModel";
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

  const { experimentId, editLevel, enableAutoUpdates, title, blocks } =
    req.body;

  // Quick permission check before we create the blocks
  if (experimentId) {
    // Experiment dashboards require the dashboards feature
    if (!context.hasPremiumFeature("dashboards")) {
      context.permissions.throwPermissionError();
    }
    const experiment = await getExperimentById(context, experimentId);
    if (!experiment) throw new Error("Cannot find experiment");
    if (!context.permissions.canCreateReport(experiment)) {
      context.permissions.throwPermissionError();
    }
  } else {
    // General dashboards require the product-analytics-dashboards feature
    if (!context.hasPremiumFeature("product-analytics-dashboards")) {
      context.permissions.throwPermissionError();
    }
    if (!context.permissions.canCreateGeneralDashboards(req.body)) {
      context.permissions.throwPermissionError();
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
    enableAutoUpdates,
    experimentId: experimentId || undefined,
    title,
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

  // Permission check before we update the blocks
  //MKTODO: Revisit this logic
  if (updates.blocks) {
    // Duplicate permissions checks to prevent persisting the child blocks if the user doesn't have permission
    const isOwner = context.userId === dashboard.userId || !dashboard.userId;
    const isAdmin = context.permissions.canSuperDeleteReport();
    let canEdit = isOwner || isAdmin;

    if (!canEdit) {
      if (experiment) {
        canEdit =
          dashboard.editLevel === "organization" &&
          context.permissions.canUpdateReport(experiment);
      } else {
        context.permissions.canUpdateGeneralDashboards(dashboard, updates);
      }
    }

    const canManage = isOwner || isAdmin;

    if (!canEdit) context.permissions.throwPermissionError();
    if (
      ("title" in updates ||
        "editLevel" in updates ||
        "enableAutoUpdates" in updates) &&
      !canManage
    ) {
      return context.permissions.throwPermissionError();
    }

    const createdBlocks = await Promise.all(
      updates.blocks.map((blockData) => {
        if (blockData.type === "metric-explorer") {
          blockData.analysisSettings.startDate = getValidDate(
            blockData.analysisSettings.startDate,
          );
          blockData.analysisSettings.endDate = getValidDate(
            blockData.analysisSettings.endDate,
          );
        }
        return isPersistedDashboardBlock(blockData as DashboardBlockInterface)
          ? blockData
          : createDashboardBlock(context.org.id, blockData);
      }),
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
        useCache: false,
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
        factTableMap: await getFactTableMap(context),
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
