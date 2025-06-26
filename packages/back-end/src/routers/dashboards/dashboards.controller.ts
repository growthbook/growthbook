import { z } from "zod";
import { isPersistedDashboardBlock } from "shared/enterprise";
import {
  AuthRequest,
  ResponseWithStatusAndError,
} from "back-end/src/types/AuthRequest";
import { getContextFromReq } from "back-end/src/services/organizations";
import { DashboardInstanceInterface } from "back-end/src/enterprise/validators/dashboard-instance";
import { createDashboardBlock } from "back-end/src/enterprise/models/DashboardBlockModel";
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

  const { experimentId, title, blocks } = req.body;

  const createdBlocks = await Promise.all(
    blocks.map((blockData) => createDashboardBlock(context.org.id, blockData))
  );
  // TODO: create snapshots as needed

  const dashboard = await context.models.dashboards.create({
    owner: context.userName,
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
  const { title, blocks } = req.body;

  const updates: Partial<DashboardInstanceInterface> = {
    title,
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

// function sanitizeUserSettings(
//   userSettings: DashboardSettingsStringDates
// ): DashboardSettingsInterface {
//   return {
//     ...userSettings,
//     dateStart: getValidDate(
//       userSettings.dateStart,
//       new Date(Date.now() - 30 * 1000 * 3600 * 24)
//     ),
//     dateEnd: getValidDate(userSettings.dateEnd, new Date()),
//   };
// }
