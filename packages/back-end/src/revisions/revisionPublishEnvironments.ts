import { ConfigInterface } from "shared/types/config";
import {
  configPublishEnvironments as configPublishEnvs,
  constantPublishEnvironments as constantPublishEnvs,
} from "shared/util";
import { serveFootprint } from "shared/permissions";
import type { Context } from "back-end/src/models/BaseModel";
import { getEnvironments } from "back-end/src/services/organizations";

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

/**
 * The footprint for a change that takes an entity OUT of service or returns it —
 * everywhere it serves.
 *
 * Both an adapter and its internal controller answer this question, and the first
 * cut fixed only the adapter: the REST archive endpoint refused a dev-limited
 * deleter while the dashboard's PUT still passed the scoped list, which is empty
 * for a base Config and so SKIPPED the environment check entirely. One function,
 * called by both, is the only way that stays fixed.
 *
 * `scoped` is the entity's own environment binding when it has one — a Config's
 * scoped overrides. Empty means unbound, and unbound means everywhere, never
 * "nowhere".
 */
export function archiveServeFootprint(
  context: Context,
  entity: {
    project?: string;
    targetingProjects?: string[];
    targetingAllProjects?: boolean;
  },
  scoped: string[] = [],
): string[] {
  if (scoped.length) return scoped;
  return serveFootprint(getEnvironments(context.org), entity);
}
