import { PostMetricGroupResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { postMetricGroupValidator } from "back-end/src/validators/openapi";
import { getDataSourceById } from "back-end/src/models/DataSourceModel";

export const postMetricGroup = createApiRequestHandler(
  postMetricGroupValidator
)(
  async (req): Promise<PostMetricGroupResponse> => {
    const data = req.body;
    const context = req.context;
    if (!context.permissions.canCreateMetricGroup()) {
      context.permissions.throwPermissionError();
    }
    const datasourceDoc = await getDataSourceById(context, data.datasource);
    if (!datasourceDoc) {
      throw new Error("Invalid data source");
    }
    const baseMetricGroup = {
      ...data,
      owner: data.owner || "",
      description: data.description || "",
      tags: data.tags || [],
      projects: data.projects || [],
      archived: data.archived || false,
      metrics: data.metrics || [],
    };
    const doc = await context.models.metricGroups.create(baseMetricGroup);
    return {
      metricGroup: context.models.metricGroups.toMetricGroupApiInterface(doc),
    };
  }
);
