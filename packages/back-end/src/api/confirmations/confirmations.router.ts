import { OpenApiRoute } from "back-end/src/util/handler";
import { getConfirmation } from "./getConfirmation";

export const confirmationsRoutes: OpenApiRoute[] = [getConfirmation];
