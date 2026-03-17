import {
  apiCreateMetricGroupBody,
  apiMetricGroupValidator,
  apiUpdateMetricGroupBody,
} from "shared/validators";
import { OpenApiModelSpec } from "back-end/src/api/ApiModel";

export const metricGroupApiSpec = {
  modelSingular: "metricGroup",
  modelPlural: "metricGroups",
  pathBase: "/metric-groups",
  apiInterface: apiMetricGroupValidator,
  schemas: {
    createBody: apiCreateMetricGroupBody,
    updateBody: apiUpdateMetricGroupBody,
  },
  includeDefaultCrud: true,
} satisfies OpenApiModelSpec;
export default metricGroupApiSpec;
