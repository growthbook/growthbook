import { z } from "zod";
import {
  blockHasFieldOfType,
  dashboardBlockHasIds,
  snapshotSatisfiesBlock,
  DashboardInterface,
  DashboardBlockInterface,
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
import {
  getEligibleTemplates,
  getTemplateById,
  instantiateTemplate,
  DashboardTemplateMetadata,
} from "back-end/src/enterprise/services/dashboard-templates";
import {
  createDashboardBody,
  createDashboardFromTemplateBody,
  updateDashboardBody,
} from "./dashboards.router";
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

export async function listDashboardTemplates(
  req: AuthRequest<never, never, { datasourceId: string }>,
  res: ResponseWithStatusAndError<{
    templates: DashboardTemplateMetadata[];
  }>,
) {
  const context = getContextFromReq(req);
  const { datasourceId } = req.query;

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return res
      .status(404)
      .json({ status: 404, message: "Datasource not found" });
  }

  // Gate the suggestion behind the same commercial feature general
  // product-analytics dashboard creation uses. Without it, the user
  // wouldn't be able to instantiate the template anyway.
  if (!context.hasPremiumFeature("product-analytics-dashboards")) {
    return res.status(200).json({ status: 200, templates: [] });
  }

  const templates = getEligibleTemplates({ datasource });
  return res.status(200).json({ status: 200, templates });
}

export async function createDashboardFromTemplate(
  req: AuthRequest<
    z.infer<typeof createDashboardFromTemplateBody>,
    never,
    never
  >,
  res: ResponseWithStatusAndError<SingleDashboardResponse>,
) {
  const context = getContextFromReq(req);
  const { templateId, datasourceId, title, projects } = req.body;

  const template = getTemplateById(templateId);
  if (!template) {
    return res.status(404).json({ status: 404, message: "Template not found" });
  }

  const datasource = await getDataSourceById(context, datasourceId);
  if (!datasource) {
    return res
      .status(404)
      .json({ status: 404, message: "Datasource not found" });
  }

  if (!template.isEligible({ datasource })) {
    return res.status(400).json({
      status: 400,
      message: "Template is not eligible for this datasource",
    });
  }

  const { title: defaultTitle, blocks: intentBlocks } =
    await instantiateTemplate(context, template, datasource);

  if (intentBlocks.length === 0) {
    return res.status(400).json({
      status: 400,
      message:
        "Template produced no blocks for this datasource. Make sure you have fact tables created from your GA4 export.",
    });
  }

  const createdBlocks = intentBlocks.map((blockData) =>
    generateDashboardBlockIds(context.org.id, blockData),
  );

  // Reuse the existing dashboard create path so permissions, audit logs,
  // id assignment, and saved-query linkage all flow through the same code.
  // editLevel/shareLevel mirror the defaults from /product-analytics/dashboards/new
  // so we only require the same Pro commercial feature; the user can
  // elevate to "published" once the dashboard exists.
  const dashboard = await context.models.dashboards.create({
    isDefault: false,
    isDeleted: false,
    userId: context.userId,
    editLevel: "private",
    shareLevel: "private",
    enableAutoUpdates: false,
    experimentId: undefined,
    title: title || defaultTitle,
    projects: projects ?? datasource.projects ?? [],
    blocks: createdBlocks,
  });

  return res.status(200).json({ status: 200, dashboard });
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
    userId,
  } = req.body;

  const createdBlocks = blocks.map((blockData) =>
    generateDashboardBlockIds(context.org.id, blockData),
  );

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
    const migratedBlocks = updates.blocks.map(migrateBlock);
    const createdBlocks = migratedBlocks.map((blockData) =>
      dashboardBlockHasIds(blockData)
        ? blockData
        : generateDashboardBlockIds(context.org.id, blockData),
    );
    updates.blocks = createdBlocks;
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
  if (dashboard.experimentId) {
    const experiment = await getExperimentById(context, dashboard.experimentId);
    if (!experiment)
      throw new Error("Cannot update dashboard without an attached experiment");

    const datasource = await getDataSourceById(context, experiment.datasource);
    if (!datasource) throw new Error("Failed to find connected datasource");

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
    await updateDashboardExplorations(context, newBlocks);

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
      dashboard.blocks
        .filter(
          (
            block,
          ): block is DashboardBlockInterface & {
            explorerAnalysisId: string;
          } =>
            (block.type === "metric-exploration" ||
              block.type === "fact-table-exploration" ||
              block.type === "data-source-exploration") &&
            "explorerAnalysisId" in block &&
            typeof (block as { explorerAnalysisId?: string })
              .explorerAnalysisId === "string" &&
            (block as { explorerAnalysisId: string }).explorerAnalysisId
              .length > 0,
        )
        .map((block) => block.explorerAnalysisId),
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
