import { OpenApiRoute } from "back-end/src/util/handler";
import { listApiKeys } from "./listApiKeys";
import { getApiKey } from "./getApiKey";
import { putApiKeyRoles } from "./putApiKeyRoles";

export const apiKeysRoutes: OpenApiRoute[] = [
  listApiKeys,
  getApiKey,
  putApiKeyRoles,
];
