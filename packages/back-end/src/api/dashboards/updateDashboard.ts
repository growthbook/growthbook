import { dashboardBlockHasIds } from "shared/enterprise";
import { UpdateDashboardResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateDashboardValidator } from "back-end/src/validators/openapi";
import {
  fromBlockApiInterface,
  generateDashboardBlockIds,
  migrateBlock,
} from "back-end/src/enterprise/models/DashboardModel";
import { DashboardInterface } from "back-end/src/enterprise/validators/dashboard";

export const updateDashboard = createApiRequestHandler(
  updateDashboardValidator,
)(async (req): Promise<UpdateDashboardResponse> => {
  const { id } = req.params;
  const updates: Partial<DashboardInterface> = {
    ...req.body,
    blocks: undefined,
  };
  if (req.body.blocks) {
    const migratedBlocks = req.body.blocks
      .map(fromBlockApiInterface)
      .map(migrateBlock);
    const createdBlocks = await Promise.all(
      migratedBlocks.map((blockData) =>
        dashboardBlockHasIds(blockData)
          ? blockData
          : generateDashboardBlockIds(req.context.org.id, blockData),
      ),
    );
    updates.blocks = createdBlocks;
  }
  const updatedDashboard = await req.context.models.dashboards.updateById(
    id,
    updates,
  );

  return {
    dashboard: req.context.models.dashboards.toApiInterface(updatedDashboard),
  };
});
