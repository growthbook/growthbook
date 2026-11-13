import {
  apiCreateSdkWebhookBody,
  apiSdkWebhookDeleteReturn,
  apiSdkWebhookListReturn,
  apiSdkWebhookReturn,
  apiSdkWebhookValidator,
  apiUpdateSdkWebhookBody,
  deleteSdkWebhookValidator,
  listSdkConnectionWebhooksValidator,
  postSdkConnectionWebhookValidator,
  putSdkWebhookValidator,
  sdkWebhookIdValidator,
} from "shared/validators";
import { OpenApiModelSpec } from "shared/api-model";

// Absolute paths: webhooks are created under their connection but updated by id
export const listSdkConnectionWebhooksEndpoint = {
  pathFragment: "/sdk-connections/:id/webhooks",
  verb: "get" as const,
  operationId: "listSdkConnectionWebhooks",
  validator: listSdkConnectionWebhooksValidator,
  zodReturnObject: apiSdkWebhookListReturn,
  summary: "Get the webhooks for an SDK Connection",
};

export const postSdkConnectionWebhookEndpoint = {
  pathFragment: "/sdk-connections/:id/webhooks",
  verb: "post" as const,
  confirmation: [
    "sdkConnection.edit",
    "override.bypassApproval",
    "override.restBypassesReviews",
  ] as const,
  operationId: "postSdkConnectionWebhook",
  validator: postSdkConnectionWebhookValidator,
  zodReturnObject: apiSdkWebhookReturn,
  summary: "Add a webhook to an SDK Connection",
  description:
    "Called whenever the connection's payload changes. `httpMethod` defaults to POST. More than one webhook per organization requires a paid plan. When the organization requires approvals for the connection, change its webhooks in a draft from the SDK Connection page instead, or pass `bypassApproval`.",
};

export const putSdkWebhookEndpoint = {
  pathFragment: "/sdk-webhooks/:id",
  verb: "put" as const,
  confirmation: [
    "sdkConnection.edit",
    "override.bypassApproval",
    "override.restBypassesReviews",
  ] as const,
  operationId: "putSdkWebhook",
  validator: putSdkWebhookValidator,
  zodReturnObject: apiSdkWebhookReturn,
  summary: "Update an SDK webhook",
  description:
    "The webhook fires once after an update. Webhooks managed by the Vercel integration can't be changed. When the organization requires approvals for a connection the webhook fires for, change it in a draft from the SDK Connection page instead, or pass `bypassApproval`.",
};

export const deleteSdkWebhookEndpoint = {
  pathFragment: "/sdk-webhooks/:id",
  verb: "delete" as const,
  confirmation: [
    "sdkConnection.edit",
    "override.bypassApproval",
    "override.restBypassesReviews",
  ] as const,
  operationId: "deleteSdkWebhook",
  validator: deleteSdkWebhookValidator,
  zodReturnObject: apiSdkWebhookDeleteReturn,
  summary: "Delete an SDK webhook",
  description:
    "Webhooks managed by the Vercel integration can't be deleted here. When the organization requires approvals for a connection the webhook fires for, remove it in a draft from the SDK Connection page instead, or pass `bypassApproval`.",
};

// A successful test clears `disabled`, which resumes delivery
export const postSdkWebhookTestEndpoint = {
  pathFragment: "/sdk-webhooks/:id/test",
  verb: "post" as const,
  confirmation: ["sdkConnection.edit"] as const,
  operationId: "postSdkWebhookTest",
  validator: sdkWebhookIdValidator,
  zodReturnObject: apiSdkWebhookReturn,
  summary: "Fire an SDK webhook now",
  description:
    "Returns the webhook with the outcome in `error` / `lastSuccess`.",
};

export const sdkWebhookApiSpec = {
  modelSingular: "sdkWebhook",
  modelPlural: "sdkWebhooks",
  pathBase: "/",
  apiInterface: apiSdkWebhookValidator,
  schemas: {
    createBody: apiCreateSdkWebhookBody,
    updateBody: apiUpdateSdkWebhookBody,
  },
  customEndpoints: [
    listSdkConnectionWebhooksEndpoint,
    postSdkConnectionWebhookEndpoint,
    putSdkWebhookEndpoint,
    deleteSdkWebhookEndpoint,
    postSdkWebhookTestEndpoint,
  ],
  navDisplayName: "SDK Webhooks",
  navDescription:
    "Webhooks that fire when an SDK Connection's payload changes. Signing keys and headers are only returned by GET.",
  navAfterTag: "sdk-connections",
} satisfies OpenApiModelSpec;
export default sdkWebhookApiSpec;
