import { OpenApiRoute } from "back-end/src/util/handler";
import { getSettings } from "./getSettings";

export const settingsRoutes: OpenApiRoute[] = [getSettings];
