import { OpenApiRoute } from "back-end/src/util/handler";
import { getSdkConnection } from "./getSdkConnection";
import { listSdkConnections } from "./listSdkConnections";
import { postSdkConnection } from "./postSdkConnection";
import { putSdkConnection } from "./putSdkConnection";
import { deleteSdkConnection } from "./deleteSdkConnection";
import { lookupSdkConnectionByKey } from "./lookupSdkConnectionByKey";
import {
  deleteSdkWebhook,
  listSdkConnectionWebhooks,
  postSdkConnectionWebhook,
  postSdkWebhookTest,
  putSdkWebhook,
} from "./sdkWebhooks";

export const sdkConnectionsRoutes: OpenApiRoute[] = [
  listSdkConnections,
  postSdkConnection,
  getSdkConnection,
  putSdkConnection,
  deleteSdkConnection,
  lookupSdkConnectionByKey,
  listSdkConnectionWebhooks,
  postSdkConnectionWebhook,
  putSdkWebhook,
  deleteSdkWebhook,
  postSdkWebhookTest,
];
