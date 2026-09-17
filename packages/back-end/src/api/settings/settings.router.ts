import { OpenApiRoute } from "back-end/src/util/handler";
import { getSettings } from "./getSettings";
import { putApprovalSettings } from "./putApprovalSettings";

export const settingsRoutes: OpenApiRoute[] = [
  getSettings,
  putApprovalSettings,
];
