import { ConfigInterface } from "shared/types/config";
import {
  configPublishEnvironments as configPublishEnvs,
  constantPublishEnvironments as constantPublishEnvs,
} from "shared/util";
import type { Context } from "back-end/src/models/BaseModel";

function orgEnvironmentIds(context: Context): string[] {
  return context.org.settings?.environments?.map((e) => e.id) ?? [];
}

// Context-bound wrappers around the shared footprint helpers, which the
// front-end also calls so both sides env-scope publish authority the same way.
export function configPublishEnvironments(
  context: Context,
  config: Pick<ConfigInterface, "scopedConfig">,
): string[] {
  return configPublishEnvs(config, orgEnvironmentIds(context));
}

export function constantPublishEnvironments(context: Context): string[] {
  return constantPublishEnvs(orgEnvironmentIds(context));
}
