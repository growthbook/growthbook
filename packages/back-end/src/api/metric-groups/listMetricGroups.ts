import { ListMetricGroupsResponse } from "back-end/types/openapi";
import {
  applyPagination,
  createApiRequestHandler,
} from "back-end/src/util/handler";
import { listMetricGroupsValidator } from "back-end/src/validators/openapi";

export const listMetricGroups = createApiRequestHandler(
  listMetricGroupsValidator
)(
  async (req): Promise<ListMetricGroupsResponse> => {
    const metricGroups = await req.context.models.metricGroups.getAll();

    // TODO: Move sorting/limiting to the database query for better performance
    const { filtered, returnFields } = applyPagination(
      metricGroups.sort((a, b) => a.id.localeCompare(b.id)),
      req.query
    );

    return {
      metricGroups: filtered.map((metricGroup) =>
        req.context.models.metricGroups.toMetricGroupApiInterface(metricGroup)
      ),
      ...returnFields,
    };
  }
);
