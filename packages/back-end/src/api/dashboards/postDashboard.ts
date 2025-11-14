import { v4 as uuidv4 } from "uuid";
import { PostDashboardResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postDashboardValidator } from "back-end/src/validators/openapi";
import {
  fromBlockApiInterface,
  generateDashboardBlockIds,
} from "back-end/src/enterprise/models/DashboardModel";

export const postDashboard = createApiRequestHandler(postDashboardValidator)(
  async (req): Promise<PostDashboardResponse> => {
    const {
      editLevel,
      shareLevel,
      enableAutoUpdates,
      updateSchedule,
      experimentId,
      title,
      projects,
      blocks,
    } = req.body;

    const createdBlocks = await Promise.all(
      blocks.map((blockData) =>
        generateDashboardBlockIds(
          req.context.org.id,
          fromBlockApiInterface(blockData),
        ),
      ),
    );
    const dashboard = await req.context.models.dashboards.create({
      uid: uuidv4().replace(/-/g, ""), // TODO: Move to BaseModel
      isDefault: false,
      isDeleted: false,
      userId: req.context.userId,
      editLevel,
      shareLevel,
      enableAutoUpdates,
      updateSchedule,
      experimentId: experimentId || undefined,
      title,
      projects,
      blocks: createdBlocks,
    });

    return {
      dashboard: req.context.models.dashboards.toApiInterface(dashboard),
    };
  },
);
