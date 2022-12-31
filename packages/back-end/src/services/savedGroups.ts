import { OrganizationInterface } from "../../types/organization";
import { getAllFeatures } from "../models/FeatureModel";
import { getAffectedSDKPayloadKeys } from "../util/features";
import { refreshSDKPayloadCache } from "./features";

export async function savedGroupUpdated(
  org: OrganizationInterface,
  id: string
) {
  const allFeatures = await getAllFeatures(org.id);

  const payloadKeys = getAffectedSDKPayloadKeys(
    allFeatures,
    (rule) => rule.condition && rule.condition.includes(id)
  );

  await refreshSDKPayloadCache(org, payloadKeys, allFeatures);
}
