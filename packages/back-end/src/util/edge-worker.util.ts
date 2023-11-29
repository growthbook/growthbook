import { findSDKConnectionsByOrganization } from "../models/SdkConnectionModel";
import { SDKPayloadKey } from "../../types/sdk-payload";
import type { OrganizationInterface } from "../../types/organization";
import { REMOTE_EVAL_EDGE_HOST } from "./secrets";
import { logger } from "./logger";

const REMOTE_EVAL_ADDRESS = "/purge-kv-store";
type PurgeEdgeRemoteEval = {
  organization: OrganizationInterface;
  payloadKeys: SDKPayloadKey[];
};
export const purgeEdgeRemoteEvalSDKKeys = (
  organizationId: string,
  sdkConnectionKeys: string[]
) => {
  const bodyData = { sdkKeys: sdkConnectionKeys };
  fetch(`${REMOTE_EVAL_EDGE_HOST}${REMOTE_EVAL_ADDRESS}`, {
    method: "DELETE",
    body: JSON.stringify(bodyData),
  }).catch((error) => {
    logger.warn("failed to purge edge remote eval", {
      organizationId: organizationId,
      sdkKeys: sdkConnectionKeys,
      error,
    });
  });
};

export const purgeEdgeRemoteEvalPayloadKeys = async ({
  organization,
  payloadKeys,
}: PurgeEdgeRemoteEval) => {
  if (payloadKeys.length === 0) {
    logger.error("payloadKeys is empty edge worker purge failed", {
      organizationId: organization.id,
    });
    return;
  }
  payloadKeys = filterEnviroment(organization, payloadKeys);
  const skdKeys = await filterByPayload(organization.id, payloadKeys);
  purgeEdgeRemoteEvalSDKKeys(organization.id, skdKeys);
};

const filterByPayload = async (
  organizationId: string,
  payloadKeys: SDKPayloadKey[]
): Promise<string[]> => {
  const projects = payloadKeys.map((keys) => keys.project);
  return (await findSDKConnectionsByOrganization(organizationId))
    .filter((sdkConnection) => {
      return projects.includes(sdkConnection.project);
    })
    .map((sdkConnection) => sdkConnection.key);
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
