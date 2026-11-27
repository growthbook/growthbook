import { z } from "zod";
import {
  blockHasFieldOfType,
  dashboardBlockHasIds,
  snapshotSatisfiesBlock,
  DashboardInterface,
  DashboardBlockInterface,
  DashboardDraftOpInput,
  DashboardVersionInterface,
  resolveGlobalControlsBlockEnrollment,
} from "shared/enterprise";
import { isDefined, isString, stringToBoolean } from "shared/util";
import { groupBy } from "lodash";
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
import {
  createExperimentSnapshot,
  createExperimentSnapshotFromPlan,
  planExperimentSnapshot,
} from "back-end/src/services/experiments";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { findSnapshotsByIds } from "back-end/src/models/ExperimentSnapshotModel";
import {
  updateDashboardMetricAnalyses,
  updateDashboardExplorations,
  updateDashboardSavedQueries,
  updateNonExperimentDashboard,
} from "back-end/src/enterprise/services/dashboards";
import {
  generateDashboardBlockIds,
  migrateBlock,
} from "back-end/src/enterprise/models/DashboardModel";
import { BadRequestError, NotFoundError } from "back-end/src/util/errors";
import * as dashboardVersions from "back-end/src/enterprise/services/dashboardVersions";
import { runAIEnabledGates } from "back-end/src/enterprise/services/ai-access";
import { secondsUntilAICanBeUsedAgainForPrompt } from "back-end/src/enterprise/services/ai";
import {
  createDashboardBody,
  publishDashboardDraftBody,
  revertDashboardDraftBody,
  saveDashboardDraftBody,
  updateDashboardBody,
} from "./dashboards.router";
export { postDashboardBuilderChat } from "back-end/src/enterprise/services/dashboard-builder-agent";

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
    isDraft,
  } = req.body;

  if (isDraft && experimentId) {
    throw new BadRequestError("Experiment dashboards cannot be drafts.");
  }

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
    // A draft always belongs to its creator, since only the owner can read it.
    userId: isDraft ? context.userId : userId || context.userId,
    isDraft,
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
  if (!dashboard) throw new NotFoundError("Cannot find dashboard");

  let experiment: ExperimentInterface | null = null;

  if (dashboard.experimentId) {
    experiment = await getExperimentById(context, dashboard.experimentId);
    if (!experiment) throw new Error("Cannot find connected experiment");
  }
  await context.models.dashboards.reconcileLiveEditWithDraft(dashboard, {
    title: updates.title,
    globalControls: updates.globalControls,
    comparison: updates.comparison,
    ...(updates.blocks ? { blocks: dashboard.blocks } : {}),
  });

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
  if (!dashboard) throw new NotFoundError("Cannot find dashboard");
  if (dashboard.experimentId) {
    const experiment = await getExperimentById(context, dashboard.experimentId);
    if (!experiment)
      throw new Error("Cannot update dashboard without an attached experiment");

    const datasource = await getDataSourceById(context, experiment.datasource);
    if (!datasource) throw new Error("Failed to find connected datasource");

    // Fail fast before createExperimentSnapshotModel persists an orphan snapshot
    // record. The query runner enforces this same permission again downstream.
    if (!context.permissions.canCreateExperimentSnapshot(datasource)) {
      context.permissions.throwPermissionError();
    }

    const plannedExperimentMainSnapshot = await planExperimentSnapshot({
      context,
      experiment,
      dimension: undefined,
      datasource,
      phase: experiment.phases.length - 1,
      useCache: false,
      triggeredBy: "manual-dashboard",
      type: "standard",
    });

    const mainSnapshot = plannedExperimentMainSnapshot.snapshot;
    let mainSnapshotUsed = false;
    // Copy the blocks of the dashboard to overwrite their snapshot IDs
    const newBlocks = dashboard.blocks.map((block) => {
      if (!blockHasFieldOfType(block, "snapshotId", isString))
        return { ...block };
      if (!snapshotSatisfiesBlock(mainSnapshot, block)) return { ...block };
      mainSnapshotUsed = true;
      return { ...block, snapshotId: mainSnapshot.id };
    });
    if (mainSnapshotUsed) {
      await createExperimentSnapshotFromPlan({
        plan: plannedExperimentMainSnapshot,
        context,
        experiment,
      });
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
    await updateDashboardExplorations(context, newBlocks, dashboard);

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
  req: AuthRequest<never, { id: string }, { version?: string }>,
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
  if (!dashboard) throw new NotFoundError("Cannot find dashboard");
  // An editor's page renders the draft, so its blocks need their data too.
  const blocks = dashboard.experimentId
    ? dashboard.blocks
    : [
        ...dashboard.blocks,
        ...(await dashboardVersions.getDashboardWorkingContent(context, id))
          .blocks,
        // A version being previewed from the history.
        ...(req.query.version
          ? ((await dashboardVersions.getDashboardVersions(context, id)).find(
              (v) => String(v.version) === req.query.version,
            )?.content.blocks ?? [])
          : []),
      ];
  let snapshots: ExperimentSnapshotInterface[] = [];
  if (dashboard.experimentId) {
    const experiment = await getExperimentById(context, dashboard.experimentId);
    const snapshotIds = [
      ...new Set([
        experiment?.analysisSummary?.snapshotId,
        ...blocks.map((block) => block.snapshotId),
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
      blocks
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
      blocks
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
      blocks.flatMap((block) => {
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

interface DraftResponse {
  status: number;
  draft: DashboardVersionInterface | null;
}

export async function getDashboardDraft(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<DraftResponse>,
) {
  const draft = await dashboardVersions.getDashboardDraft(
    getContextFromReq(req),
    req.params.id,
  );
  return res.status(200).json({ status: 200, draft });
}

export async function createDashboardDraft(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<DraftResponse>,
) {
  const draft = await dashboardVersions.getOrCreateDashboardDraft(
    getContextFromReq(req),
    req.params.id,
  );
  return res.status(200).json({ status: 200, draft });
}

export async function editDashboardDraft(
  req: AuthRequest<DashboardDraftOpInput, { id: string }, never>,
  res: ResponseWithStatusAndError<DraftResponse>,
) {
  const context = getContextFromReq(req);
  // Dashboard-wide controls change what charts show, so this path re-runs them.
  const draft =
    req.body.op === "set-settings" &&
    (req.body.settings.globalControls !== undefined ||
      req.body.settings.comparison !== undefined)
      ? await dashboardVersions.updateDashboardDraftSettings(
          context,
          req.params.id,
          req.body.settings,
        )
      : await dashboardVersions.editDashboardDraft(
          context,
          req.params.id,
          req.body,
        );
  return res.status(200).json({ status: 200, draft });
}

export async function saveDashboardDraft(
  req: AuthRequest<
    z.infer<typeof saveDashboardDraftBody>,
    { id: string },
    never
  >,
  res: ResponseWithStatusAndError<DraftResponse>,
) {
  const context = getContextFromReq(req);
  const { blocks, ...settings } = req.body;
  const saved = await dashboardVersions.saveDashboardDraftContent(
    context,
    req.params.id,
    {
      ...settings,
      ...(blocks
        ? {
            blocks: blocks
              .map(migrateBlock)
              .map((block) =>
                dashboardBlockHasIds(block)
                  ? block
                  : generateDashboardBlockIds(context.org.id, block),
              ),
          }
        : {}),
    },
  );
  // A new date range, filter or comparison needs the charts run again.
  const draft =
    settings.globalControls !== undefined || settings.comparison !== undefined
      ? await dashboardVersions.rerunDashboardDraftCharts(
          context,
          req.params.id,
          saved,
        )
      : saved;
  return res.status(200).json({ status: 200, draft });
}

export async function getDashboardVersions(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<{
    status: number;
    versions: DashboardVersionInterface[];
  }>,
) {
  const versions = await dashboardVersions.getDashboardVersions(
    getContextFromReq(req),
    req.params.id,
  );
  return res.status(200).json({ status: 200, versions });
}

export async function restoreDashboardVersion(
  req: AuthRequest<{ version: number }, { id: string }, never>,
  res: ResponseWithStatusAndError<DraftResponse>,
) {
  const draft = await dashboardVersions.restoreDashboardVersion(
    getContextFromReq(req),
    req.params.id,
    req.body.version,
  );
  return res.status(200).json({ status: 200, draft });
}

export async function revertDashboardDraftChange(
  req: AuthRequest<
    z.infer<typeof revertDashboardDraftBody>,
    { id: string },
    never
  >,
  res: ResponseWithStatusAndError<DraftResponse>,
) {
  const draft = await dashboardVersions.revertDashboardDraftChange(
    getContextFromReq(req),
    req.params.id,
    req.body,
  );
  return res.status(200).json({ status: 200, draft });
}

export async function undoDashboardDraft(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<DraftResponse>,
) {
  const draft = await dashboardVersions.undoDashboardDraft(
    getContextFromReq(req),
    req.params.id,
  );
  return res.status(200).json({ status: 200, draft });
}

export async function summarizeDashboardDraft(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<{ status: number; summary: string }>,
) {
  const context = getContextFromReq(req);
  if (!(await runAIEnabledGates(context, res))) return;
  const retryAfter = await secondsUntilAICanBeUsedAgainForPrompt(
    context,
    "product-analytics-chat",
  );
  if (retryAfter > 0) {
    return res
      .status(429)
      .json({ status: 429, message: "Over AI usage limits", retryAfter });
  }
  const summary = await dashboardVersions.summarizeDashboardDraft(
    context,
    req.params.id,
  );
  return res.status(200).json({ status: 200, summary });
}

export async function publishDashboardDraft(
  req: AuthRequest<
    z.infer<typeof publishDashboardDraftBody>,
    { id: string },
    never
  >,
  res: ResponseWithStatusAndError<
    SingleDashboardResponse & { version: DashboardVersionInterface }
  >,
) {
  const result = await dashboardVersions.publishDashboardDraft(
    getContextFromReq(req),
    req.params.id,
    req.body.note,
  );
  return res.status(200).json({ status: 200, ...result });
}

export async function discardDashboardDraft(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError,
) {
  await dashboardVersions.discardDashboardDraft(
    getContextFromReq(req),
    req.params.id,
  );
  return res.status(200).json({ status: 200 });
}
