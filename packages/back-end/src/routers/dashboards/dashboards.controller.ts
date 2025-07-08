import { z } from "zod";
import {
  blockHasFieldOfType,
  isPersistedDashboardBlock,
} from "shared/enterprise";
import { isDefined } from "shared/util";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import { createDashboardBlock } from "back-end/src/enterprise/models/DashboardBlockModel";
import { SqlExplorerBlockInterface } from "back-end/src/enterprise/validators/dashboard-block";
import {
  createExperimentSnapshot,
  SNAPSHOT_TIMEOUT,
} from "back-end/src/controllers/experiments";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { executeAndSaveQuery } from "back-end/src/routers/saved-queries/saved-queries.controller";
import { createDashboardBody, updateDashboardBody } from "./dashboards.router";

interface SingleDashboardResponse {
  status: number;
  dashboard: DashboardInstanceInterface;
}

export async function createDashboard(
  req: AuthRequest<z.infer<typeof createDashboardBody>, never, never>,
  res: ResponseWithStatusAndError<SingleDashboardResponse>
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("dashboards")) {
    throw new Error("Must have a commercial License Key to create Dashboards");
  }

  const { experimentId, editLevel, title, blocks } = req.body;

  const createdBlocks = await Promise.all(
    blocks.map((blockData) => createDashboardBlock(context.org.id, blockData))
  );
  // TODO: create snapshots as needed

  const dashboard = await context.models.dashboards.create({
    owner: context.userName,
    userId: context.userId,
    editLevel,
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
  const { title, blocks, editLevel } = req.body;

  const updates: Partial<DashboardInstanceInterface> = {
    title,
    editLevel,
  };
  if (blocks) {
    const createdBlocks = await Promise.all(
      blocks.map((blockData) =>
        isPersistedDashboardBlock(blockData)
          ? blockData
          : createDashboardBlock(context.org.id, blockData)
      )
    );
    // TODO: side-effect of updating snapshots as needed
    updates.blocks = createdBlocks;
  }

  const updatedDashboard = await context.models.dashboards.updateById(
    id,
    updates
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
  if (!context.hasPremiumFeature("dashboards")) {
    throw new Error("Must have a commercial License Key to manage Dashboards");
  }

  const { id } = req.params;
  await context.models.dashboards.deleteById(id);
  return res.status(200).json({ status: 200 });
}

export async function refreshDashboardData(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError
) {
  const context = getContextFromReq(req);
  if (!context.hasPremiumFeature("dashboards")) {
    throw new Error("Must have a commercial License Key to use Dashboards");
  }

  const { id } = req.params;
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) throw new Error("Dashboard not found!");
  const experiment = await getExperimentById(context, dashboard.experimentId);
  if (!experiment)
    throw new Error("Cannot update dashboard without an attached experiment");
  const datasource = await getDataSourceById(context, experiment.datasource);
  if (!datasource) throw new Error("Failed to find connected datasource");

  const dimensions = [
    ...new Set(
      dashboard.blocks
        .map((block) =>
          blockHasFieldOfType(
            block,
            "dimensionId",
            (val: unknown) => typeof val === "string"
          )
            ? block.dimensionId
            : undefined
        )
        .filter(isDefined)
    ),
  ];
  const savedQueries = await context.models.savedQueries.getByIds([
    ...new Set(
      dashboard.blocks
        .filter((block) => block.type === "sql-explorer" && block.savedQueryId)
        .map((block: SqlExplorerBlockInterface) => block.savedQueryId!)
    ),
  ]);
  // This is doing an expensive analytics SQL query, so may take a long time
  // Set timeout to 30 minutes
  req.setTimeout(SNAPSHOT_TIMEOUT);

  const createSnapshotReturns = await Promise.all([
    createExperimentSnapshot({
      context,
      experiment,
      dimension: undefined,
      datasource,
      phase: experiment.phases.length - 1,
      useCache: false,
      triggeredBy: "manual",
    }),
    ...dimensions.map((dimensionId) =>
      createExperimentSnapshot({
        context,
        experiment,
        dimension: dimensionId,
        datasource,
        phase: experiment.phases.length - 1,
        useCache: false,
        triggeredBy: "manual",
      })
    ),
  ]);
  await Promise.all([
    ...createSnapshotReturns.map(
      ({ queryRunner }) => queryRunner.waitForResults
    ),
    ...savedQueries.map((savedQuery) =>
      executeAndSaveQuery(context, savedQuery, datasource)
    ),
  ]);

  return res.status(200).json({ status: 200 });
}
