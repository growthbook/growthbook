import { OpenApiRoute } from "back-end/src/util/handler";
import {
  deleteApiKey,
  listApiKeys,
  postApiKeyDisable,
  postApiKeyEnable,
} from "./apiKeys";

export const apiKeysRoutes: OpenApiRoute[] = [
  listApiKeys,
  postApiKeyDisable,
  postApiKeyEnable,
  deleteApiKey,
];
