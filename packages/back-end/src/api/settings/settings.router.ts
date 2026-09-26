import { OpenApiRoute } from "back-end/src/util/handler";
import { getSettings } from "./getSettings";
import { putApprovalSettings } from "./putApprovalSettings";
import { putSettings } from "./putSettings";

export const settingsRoutes: OpenApiRoute[] = [
  getSettings,
  putSettings,
  putApprovalSettings,
];
