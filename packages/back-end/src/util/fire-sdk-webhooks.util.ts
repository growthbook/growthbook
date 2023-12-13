import {
  findSDKConnectionByKey,
  findSDKConnectionsByOrganization,
} from "../models/SdkConnectionModel";
import { SDKPayloadKey } from "../../types/sdk-payload";
import type { OrganizationInterface } from "../../types/organization";
import { SDKConnectionInterface } from "../../types/sdk-connection";
import { WebhookModel } from "../models/WebhookModel";
import { getFeatureDefinitions } from "../services/features";
import { WebhookInterface } from "../../types/webhook";
import { REMOTE_EVAL_EDGE_API_TOKEN, REMOTE_EVAL_EDGE_HOST } from "./secrets";
import { logger } from "./logger";

const REMOTE_EVAL_ADDRESS = "/purge-kv-store";
type fireSdkWebhooksWithPayloadKeys = {
  organization: OrganizationInterface;
  payloadKeys: SDKPayloadKey[];
};

const sendPayloadWithPayload = async (
  organizationId: string,
  sdkConnectionKeys: string[],
  webhook: WebhookInterface
) => {
  for (const sdkKey of sdkConnectionKeys) {
    const connection = await findSDKConnectionByKey(sdkKey);
    if (!connection) {
      // not sure what we use to show errors
      return;
    }
    const payload = await getFeatureDefinitions({
      organization: connection.organization,
      environment: connection.environment,
      projects: connection.projects,
      encryptionKey: connection.encryptPayload
        ? connection.encryptionKey
        : undefined,

      includeVisualExperiments: connection.includeVisualExperiments,
      includeDraftExperiments: connection.includeDraftExperiments,
      includeExperimentNames: connection.includeExperimentNames,
      hashSecureAttributes: connection.hashSecureAttributes,
    });
    const body = { payload };
    const { sdks, endpoint, signingKey } = webhook;
    await fetchForSendingPayload(
      body,
      endpoint,
      signingKey,
      organizationId,
      sdkKey
    );
  }
};

const fetchForSendingPayload = async (
  body: Record<string, unknown>,
  endpoint: string,
  signingKey: string,
  organizationId: string,
  sdkConnectionKey: string
) => {
  await fetch(`${endpoint}`, {
    headers: {
      "X-GrowthBook-Signature": signingKey,
    },
    body: JSON.stringify(body),
  }).catch((error) => {
    logger.warn("failed to purge edge remote eval", {
      organizationId: organizationId,
      clientKeys: sdkConnectionKey,
      error,
    });
  });
};

export const fireWebhookForSDKKeys = async (
  organizationId: string,
  sdkConnectionKeys: string[]
) => {
  const webhooks = await WebhookModel.find({
    organization: organizationId,
    sdks: { $in: sdkConnectionKeys },
    useSDKMode: true,
  });

  webhooks.forEach((webhook) => {
    const { sdks, endpoint, signingKey, sendPayload } = webhook;
    if (sendPayload) {
      sendPayloadWithPayload(organizationId, sdkConnectionKeys, webhook);
    }
  });
};

export const fireSdkWebhooksWithPayloadKeys = async ({
  organization,
  payloadKeys,
}: fireSdkWebhooksWithPayloadKeys) => {
  if (payloadKeys.length === 0) {
    logger.error("payloadKeys is empty edge worker purge failed", {
      organizationId: organization.id,
    });
    return;
  }
  payloadKeys = filterEnviroment(organization, payloadKeys);
  const skdKeys = await filterByPayload(organization.id, payloadKeys);
  fireWebhookForSDKKeys(organization.id, skdKeys);
};

const filterByPayload = async (
  organizationId: string,
  payloadKeys: SDKPayloadKey[]
): Promise<string[]> => {
  const projects = payloadKeys.map((keys) => keys.project);
  return (await findSDKConnectionsByOrganization(organizationId))
    .filter((sdkConnection) => {
      if (sdkConnection.projects.length === 0 && projects.includes("")) {
        return checkProjectAndEnviromentMatch("", sdkConnection, payloadKeys);
      }
      for (const project of sdkConnection.projects) {
        return checkProjectAndEnviromentMatch(
          project,
          sdkConnection,
          payloadKeys
        );
      }
    })
    .map((sdkConnection) => sdkConnection.key);
};

const checkProjectAndEnviromentMatch = (
  project: string,
  sdkConnection: SDKConnectionInterface,
  payloadKeys: SDKPayloadKey[]
) => {
  for (const payloadKey of payloadKeys) {
    if (
      project === payloadKey.project &&
      payloadKey.environment === sdkConnection.environment
    ) {
      return true;
    }
  }
};

const filterEnviroment = (
  organization: OrganizationInterface,
  payloadKeys: SDKPayloadKey[]
) => {
  const allowedEnvs = new Set(
    organization.settings?.environments?.map((e) => e.id) || []
  );
  return payloadKeys.filter((k) => allowedEnvs.has(k.environment));
};
