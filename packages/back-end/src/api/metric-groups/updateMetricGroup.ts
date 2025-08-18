import { getDataSourceById } from "back-end/src/models/DataSourceModel";
import { UpdateMetricGroupResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { updateMetricGroupValidator } from "back-end/src/validators/openapi";

export const updateMetricGroup = createApiRequestHandler(
  updateMetricGroupValidator
)(
  async (req): Promise<UpdateMetricGroupResponse> => {
    const data = req.body;
    const context = req.context;
    const { org } = context;
    const metricGroup = await context.models.metricGroups.getById(
      req.params.id
    );
    if (!metricGroup) {
      throw new Error("Could not find metric group with that id");
    }
    if (org.id !== metricGroup.organization) {
      throw new Error("You don't have access to that metric group");
    }
    if (!context.permissions.canUpdateMetricGroup()) {
      context.permissions.throwPermissionError();
    }
    const datasourceDoc = await getDataSourceById(
      context,
      data?.datasource || metricGroup.datasource
    );
    if (!datasourceDoc) {
      throw new Error("Invalid data source");
    }
    const updated = await context.models.metricGroups.updateById(
      req.params.id,
      data
    );

    return {
      metricGroup: context.models.metricGroups.toMetricGroupApiInterface(
        updated
      ),
    };
  }
);
