import { getValidDate } from "shared/dates";
import { z } from "zod";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import { ExperimentSnapshotInterface } from "back-end/types/experiment-snapshot";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  DashboardInstanceInterface,
  DashboardSettingsInterface,
  DashboardSettingsStringDates,
} from "back-end/src/enterprise/validators/dashboard-instance";
import { createDashboardBlock } from "back-end/src/enterprise/models/DashboardBlockModel";
import { isPersistedDashboardBlock } from "back-end/src/enterprise/validators/dashboard-block";
import { createDashboardBody, updateDashboardBody } from "./dashboards.router";

interface GetSnapshotsResponse {
  snapshots: Record<string, ExperimentSnapshotInterface>;
}

interface SingleDashboardResponse {
  status: number;
  dashboard: DashboardInstanceInterface;
}

export async function getSnapshotsForDashboard(
  req: AuthRequest<never, { id: string }, never>,
  res: ResponseWithStatusAndError<GetSnapshotsResponse>
) {
  const context = getContextFromReq(req);
  const { id } = req.params;
  const dashboard = await context.models.dashboards.getById(id);
  if (!dashboard) {
    return res.status(404).json({ status: 404, message: "Not Found" });
  }
  // const uids = dashboard.blocks.map((b) => b.uid);
  return res.status(200).json({ status: 200, snapshots: {} });
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
    title,
    description,
    blocks,
    settings: userSettings,
  } = req.body;

  const settings = sanitizeUserSettings(userSettings);

  const createdBlocks = await Promise.all(
    blocks.map((blockData) => createDashboardBlock(context.org.id, blockData))
  );

  const dashboard = await context.models.dashboards.create({
    owner: context.userName,
    experimentId,
    title,
    description,
    blocks: createdBlocks,
    settings,
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
  const { title, description, blocks, settings } = req.body;

  const updates: Partial<DashboardInstanceInterface> = {
    title,
    description,
    settings: settings ? sanitizeUserSettings(settings) : undefined,
  };
  if (blocks) {
    const createdBlocks = await Promise.all(
      blocks.map((blockData) =>
        isPersistedDashboardBlock(blockData)
          ? blockData
          : createDashboardBlock(context.org.id, blockData)
      )
    );
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

function sanitizeUserSettings(
  userSettings: DashboardSettingsStringDates
): DashboardSettingsInterface {
  return {
    ...userSettings,
    dateStart: getValidDate(
      userSettings.dateStart,
      new Date(Date.now() - 30 * 1000 * 3600 * 24)
    ),
    dateEnd: getValidDate(userSettings.dateEnd, new Date()),
  };
}
