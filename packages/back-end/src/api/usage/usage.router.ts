import { OpenApiRoute } from "back-end/src/util/handler";
import { getMetricUsage } from "./getMetricUsage";

export const usageRoutes: OpenApiRoute[] = [getMetricUsage];
