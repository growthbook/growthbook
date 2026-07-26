import { ConfigInterface } from "shared/types/config";
import {
  configPublishEnvironments as configPublishEnvs,
  constantPublishEnvironments as constantPublishEnvs,
} from "shared/util";
import type { Context } from "back-end/src/models/BaseModel";

// Back-end shims over the shared footprint helpers, kept so call sites read the
// same as they did before the helpers stopped needing the org's env list. The
// front end calls the shared versions directly, so both sides scope identically.
export function configPublishEnvironments(
  _context: Context,
  config: Pick<ConfigInterface, "scopedConfig">,
): string[] {
  return configPublishEnvs(config);
}

export function constantPublishEnvironments(
  _context?: Context,
  changedEnvironments?: string[],
): string[] {
  return constantPublishEnvs(changedEnvironments);
}
