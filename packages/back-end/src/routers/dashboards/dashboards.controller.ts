import { z } from "zod";
import {
  blockHasFieldOfType,
  dashboardBlockHasIds,
  DashboardInterface,
  DashboardBlockInterface,
  resolveGlobalControlsBlockEnrollment,
} from "shared/enterprise";
import { isDefined, isString, stringToBoolean } from "shared/util";
import { UpdateProps } from "shared/types/base-model";
import { ProductAnalyticsExploration, SavedQuery } from "shared/validators";
import { ExperimentSnapshotInterface } from "shared/types/experiment-snapshot";
import { MetricAnalysisInterface } from "shared/types/metric-analysis";
import { ExperimentInterface } from "shared/types/experiment";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { findSnapshotsByIds } from "back-end/src/models/ExperimentSnapshotModel";
import { refreshDashboard } from "back-end/src/enterprise/services/dashboards";
import {
  generateDashboardBlockIds,
  migrateBlock,
} from "back-end/src/enterprise/models/DashboardModel";
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

  const dashboards = stringToBoolean(req.query.includeExperimentDashboards)
    ? await context.models.dashboards.getAll()
    : await context.models.dashboards.getAllNonExperimentDashboards();
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
    globalControls,
    comparison,
    userId,
  } = req.body;

  const createdBlocks = blocks.map((blockData) =>
    generateDashboardBlockIds(context.org.id, blockData),
  );
  const blocksWithGlobalControls =
    resolveGlobalControlsBlockEnrollment({
      nextGlobalControls: globalControls,
      nextBlocks: createdBlocks,
    }) ?? createdBlocks;

  const dashboard = await context.models.dashboards.create({
    isDefault: false,
    isDeleted: false,
    userId: userId || context.userId,
    editLevel,
    shareLevel,
    enableAutoUpdates,
    updateSchedule,
    experimentId: experimentId || undefined,
    title,
    projects,
    globalControls,
    comparison,
    blocks: blocksWithGlobalControls,
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
    const migratedBlocks = updates.blocks.map(migrateBlock);
    const createdBlocks = migratedBlocks.map((blockData) =>
      dashboardBlockHasIds(blockData)
        ? blockData
        : generateDashboardBlockIds(context.org.id, blockData),
    );
    updates.blocks =
      resolveGlobalControlsBlockEnrollment({
        existingGlobalControls: dashboard.globalControls,
        nextGlobalControls: updates.globalControls,
        nextBlocks: createdBlocks,
      }) ?? createdBlocks;
  } else {
    const enrolledBlocks = resolveGlobalControlsBlockEnrollment({
      existingGlobalControls: dashboard.globalControls,
      nextGlobalControls: updates.globalControls,
      existingBlocks: dashboard.blocks,
    });
    if (enrolledBlocks) updates.blocks = enrolledBlocks;
  }

  const updatedDashboard = await context.models.dashboards.updateById(
    id,
    updates as UpdateProps<DashboardInterface>,
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
  await refreshDashboard(context, dashboard);

  return res.status(200).json({ status: 200 });
}

export async function getDashboardSnapshots(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<{
    snapshots: ExperimentSnapshotInterface[];
    savedQueries: SavedQuery[];
    metricAnalyses: MetricAnalysisInterface[];
    explorations: ProductAnalyticsExploration[];
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

  const explorerAnalysisIds = [
    ...new Set(
      dashboard.blocks.flatMap((block) => {
        if (
          block.type !== "metric-exploration" &&
          block.type !== "fact-table-exploration" &&
          block.type !== "data-source-exploration" &&
          block.type !== "sql-exploration" &&
          block.type !== "funnel-exploration"
        ) {
          return [];
        }
        return [block.explorerAnalysisId, block.comparisonExplorerAnalysisId]
          .filter((id): id is string => typeof id === "string")
          .filter((id) => id.length > 0);
      }),
    ),
  ];

  const explorations: ProductAnalyticsExploration[] =
    explorerAnalysisIds.length > 0
      ? (
          await context.models.analyticsExplorations.getByIds(
            explorerAnalysisIds,
          )
        ).filter((e): e is ProductAnalyticsExploration => e != null)
      : [];

  return res.status(200).json({
    status: 200,
    snapshots,
    savedQueries,
    metricAnalyses,
    explorations,
  });
}
