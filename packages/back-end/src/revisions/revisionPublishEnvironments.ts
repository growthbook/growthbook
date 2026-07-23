import { ConfigInterface } from "shared/types/config";
import type { Context } from "back-end/src/models/BaseModel";

function orgEnvironmentIds(context: Context): string[] {
  return context.org.settings?.environments?.map((e) => e.id) ?? [];
}

// Env footprint an env-scoped config publish/revert may affect: a flavor targets
// its scoped environments; a base config's value applies to all. Conservative
// approximation (entity flavor scope, not the per-revision diff). Shared by the
// config revision adapter and the config REST endpoints so both env-scope the
// same way.
export function configPublishEnvironments(
  context: Context,
  config: Pick<ConfigInterface, "scopedConfig">,
): string[] {
  const flavorEnvs = config.scopedConfig?.environments;
  return flavorEnvs && flavorEnvs.length
    ? flavorEnvs
    : orgEnvironmentIds(context);
}

// A constant's base value and per-environment overrides can touch any
// environment, so without the per-revision diff we conservatively require
// authority across all org environments.
export function constantPublishEnvironments(context: Context): string[] {
  return orgEnvironmentIds(context);
}
