import { interleavingEnvsForChange } from "shared/permissions";
import { InterleavingInterface } from "shared/validators";
import { SDKPayloadKey } from "back-end/types/sdk-payload";
import { getSDKPayloadKeys } from "./features";

export function getInterleavingPayloadKeys(
  interleavings: InterleavingInterface[],
  allowedEnvs: string[],
): SDKPayloadKey[] {
  const environments = new Set(
    interleavings.flatMap((il) =>
      interleavingEnvsForChange({ existing: il, environmentIds: allowedEnvs }),
    ),
  );
  const projects = new Set(interleavings.map((il) => il.project || ""));
  return getSDKPayloadKeys(environments, projects);
}
