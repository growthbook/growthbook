import { HoldoutInterface } from "shared/validators";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { getSDKPayloadKeys } from "./features";

export function getEnabledEnvironments(
  holdout: HoldoutInterface,
  allowedEnvs: string[],
): Set<string> {
  const environments = new Set<string>();

  const settings = holdout.environmentSettings || {};

  Object.keys(settings)
    .filter((e) => allowedEnvs.includes(e))
    .filter((e) => settings[e].enabled)
    .forEach((e) => environments.add(e));

  return environments;
}

export function getAffectedSDKPayloadKeys(
  holdout: HoldoutInterface,
  allowedEnvs: string[],
): SDKPayloadKey[] {
  const keys: SDKPayloadKey[] = [];

  const environments = getEnabledEnvironments(holdout, allowedEnvs);

  const projects = new Set(holdout.projects);
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
