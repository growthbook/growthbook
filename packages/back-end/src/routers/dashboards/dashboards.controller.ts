import { z } from "zod";
import { v4 as uuidv4 } from "uuid";
import {
  blockHasFieldOfType,
  isPersistedDashboardBlock,
} from "shared/enterprise";
import { isDefined, isString } from "shared/util";
import { groupBy } from "lodash";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";
import { createDashboardBlock } from "back-end/src/enterprise/models/DashboardBlockModel";
import {
  DashboardBlockInterface,
  SqlExplorerBlockInterface,
} from "back-end/src/enterprise/validators/dashboard-block";
import { createExperimentSnapshot } from "back-end/src/controllers/experiments";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { executeAndSaveQuery } from "back-end/src/routers/saved-queries/saved-queries.controller";
import { findSnapshotsByIds } from "back-end/src/models/ExperimentSnapshotModel";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { SavedQuery } from "back-end/src/validators/saved-queries";
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
  req: AuthRequest<never, never, never>,
  res: ResponseWithStatusAndError<MultiDashboardResponse>
) {
  const context = getContextFromReq(req);

  const dashboards = await context.models.dashboards.getAll();
  return res.status(200).json({ status: 200, dashboards });
}

export async function getDashboardsForExperiment(
  req: AuthRequest<never, { experimentId: string }, never>,
  res: ResponseWithStatusAndError<MultiDashboardResponse>
) {
  const context = getContextFromReq(req);
  const { experimentId } = req.params;

  const dashboards = await context.models.dashboards.findByExperiment(
    experimentId
  );
  return res.status(200).json({ status: 200, dashboards });
}

export async function createDashboard(
  req: AuthRequest<z.infer<typeof createDashboardBody>, never, never>,
  res: ResponseWithStatusAndError<SingleDashboardResponse>
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("dashboards")) {
    throw new Error("Must have a commercial License Key to create Dashboards");
  }

  const {
    experimentId,
    editLevel,
    enableAutoUpdates,
    title,
    blocks,
  } = req.body;

  // Duplicate permissions checks to prevent persisting the child blocks if the user doesn't have permission
  const experiment = await getExperimentById(context, experimentId);
  if (!experiment) throw new Error("Cannot find experiment");
  if (!context.permissions.canCreateReport(experiment)) {
    context.permissions.throwPermissionError();
  }

  const createdBlocks = await Promise.all(
    blocks.map((blockData) => createDashboardBlock(context.org.id, blockData))
  );

  const dashboard = await context.models.dashboards.create({
    uid: uuidv4().replace(/-/g, ""), // TODO: Move to BaseModel
    isDefault: false,
    isDeleted: false,
    userId: context.userId,
    editLevel,
    enableAutoUpdates,
    experimentId,
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
  res: ResponseWithStatusAndError<SingleDashboardResponse>
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("dashboards")) {
    throw new Error("Must have a commercial License Key to manage Dashboards");
  }

  const { id } = req.params;
  const updates = { ...req.body };
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) throw new Error("Cannot find dashboard");
  const experiment = await getExperimentById(context, dashboard.experimentId);
  if (!experiment) throw new Error("Cannot find connected experiment");

  if (updates.blocks) {
    // Duplicate permissions checks to prevent persisting the child blocks if the user doesn't have permission
    const isOwner = context.userId === dashboard.userId || !dashboard.userId;
    const isAdmin = context.permissions.canSuperDeleteReport();
    const canEdit =
      isOwner ||
      isAdmin ||
      (dashboard.editLevel === "organization" &&
        context.permissions.canUpdateReport(experiment));
    const canManage = isOwner || isAdmin;

    if (!canEdit) context.permissions.throwPermissionError();
    if (
      ("title" in updates ||
        "editLevel" in updates ||
        "enableAutoUpdates" in updates) &&
      !canManage
    ) {
      context.permissions.throwPermissionError();
    }

    const createdBlocks = await Promise.all(
      updates.blocks.map((blockData) =>
        isPersistedDashboardBlock(blockData)
          ? blockData
          : createDashboardBlock(context.org.id, blockData)
      )
    );
    updates.blocks = createdBlocks;
  }

  const updatedDashboard = await context.models.dashboards.updateById(
    id,
    updates as Partial<DashboardInterface>
  );

  res.status(200).json({
    status: 200,
    dashboard: updatedDashboard,
  });
}

export async function deleteDashboard(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  await context.models.dashboards.deleteById(id);
  return res.status(200).json({ status: 200 });
}

export async function refreshDashboardData(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) throw new Error("Cannot find dashboard");
  const experiment = await getExperimentById(context, dashboard.experimentId);
  if (!experiment)
    throw new Error("Cannot update dashboard without an attached experiment");
  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) throw new Error("Failed to find connected datasource");

  const { snapshot: mainSnapshot } = await createExperimentSnapshot({
    context,
    experiment,
    dimension: undefined,
    datasource,
    phase: experiment.phases.length - 1,
    useCache: false,
    triggeredBy: "manual",
  });

  // Copy the blocks of the dashboard to overwrite their snapshot IDs
  const newBlocks = dashboard.blocks.map((block) =>
    blockHasFieldOfType(block, "snapshotId", isString)
      ? { ...block, snapshotId: mainSnapshot.id }
      : { ...block }
  );

  const dimensionBlockPairs = dashboard.blocks
    .map<[string, string] | undefined>((block) =>
      blockHasFieldOfType(block, "dimensionId", isString)
        ? [block.dimensionId, block.id]
        : undefined
    )
    .filter(isDefined);

  // Create a map from dimension -> list of block IDs that use that dimension
  const dimensionsByBlocks = Object.fromEntries(
    Object.entries(
      groupBy(dimensionBlockPairs, ([dimensionId, _blockId]) => dimensionId)
    ).map(([dimensionId, dimBlockPairs]) => [
      dimensionId,
      dimBlockPairs.map(([_dim, blockId]) => blockId),
    ])
  );

  for (const [dimensionId, blockIds] of Object.entries(dimensionsByBlocks)) {
    const { snapshot } = await createExperimentSnapshot({
      context,
      experiment,
      dimension: dimensionId,
      datasource,
      phase: experiment.phases.length - 1,
      useCache: false,
      triggeredBy: "manual",
    });
    newBlocks.forEach((block) => {
      if (blockIds.includes(block.id)) {
        block.snapshotId = snapshot.id;
      }
    });
  }
  // Bypassing permissions here allows free orgs to refresh the default dashboard
  await context.models.dashboards.dangerousUpdateBypassPermission(dashboard, {
    blocks: newBlocks,
  });

  const savedQueries = await context.models.savedQueries.getByIds([
    ...new Set(
      dashboard.blocks
        .filter((block) => block.type === "sql-explorer" && block.savedQueryId)
        .map((block: SqlExplorerBlockInterface) => block.savedQueryId!)
    ),
  ]);

  for (const savedQuery of savedQueries) {
    executeAndSaveQuery(context, savedQuery, datasource);
  }

  return res.status(200).json({ status: 200 });
}

export async function getDashboardSnapshots(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<{
    snapshots: ExperimentSnapshotInterface[];
    savedQueries: SavedQuery[];
  }>
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) throw new Error("Cannot find dashboard");
  const experiment = await getExperimentById(context, dashboard.experimentId);
  const snapshotIds = [
    ...new Set([
      experiment?.analysisSummary?.snapshotId,
      ...dashboard.blocks.map((block) => block.snapshotId),
    ]),
  ].filter(
    (snapId): snapId is string => isDefined(snapId) && snapId.length > 0
  );
  const snapshots = await findSnapshotsByIds(context, snapshotIds);
  const savedQueries = await context.models.savedQueries.getByIds([
    ...new Set(
      dashboard.blocks
        .filter(
          (
            block
          ): block is Extract<
            DashboardBlockInterface,
            { savedQueryId: string }
          > =>
            blockHasFieldOfType(block, "savedQueryId", isString) &&
            block.savedQueryId.length > 0
        )
        .map((block) => block.savedQueryId)
    ),
  ]);
  return res.status(200).json({ status: 200, snapshots, savedQueries });
}
