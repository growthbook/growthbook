import type { OpenApiRoute } from "back-end/src/util/handler";
import { getExperimentSnapshot } from "./getExperimentSnapshot";

export const snapshotsRoutes: OpenApiRoute[] = [getExperimentSnapshot];
