import { getEnabledHoldoutEnvironments } from "shared/util";
import { HoldoutInterface } from "shared/validators";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { getSDKPayloadKeys } from "./features";

export function getAffectedSDKPayloadKeys(
  holdout: HoldoutInterface,
  allowedEnvs: string[],
): SDKPayloadKey[] {
  const keys: SDKPayloadKey[] = [];

  const environments = new Set(
    getEnabledHoldoutEnvironments(holdout.environmentSettings, allowedEnvs),
  );

  const projects = new Set(
    holdout.projects.length > 0 ? holdout.projects : [""],
  );
  keys.push(...getSDKPayloadKeys(environments, projects));

  // Unique the list
  const usedKeys = new Set<string>();

  return keys.filter((key) => {
    const s = JSON.stringify(key);
    if (usedKeys.has(s)) return false;
    usedKeys.add(s);
    return true;
  });
}
