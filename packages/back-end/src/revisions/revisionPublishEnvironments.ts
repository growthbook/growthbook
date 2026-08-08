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
 * A change's environment reach, stated by the adapter rather than inferred.
 *
 * The permission layer ends in `envs.every(...)`, so `[]` ALLOWS every environment
 * instead of checking them. Two different things were both spelled `[]`:
 *
 *  - `unscoped`   — no environment dimension at all. A Constant's base value is
 *                   declared design: a dev-limited editor may change it.
 *  - `everywhere` — reaches every environment the entity serves while naming none.
 *                   An archive flip; read as `[]` it let a dev-limited caller
 *                   archive production.
 *
 * Naming them makes the vacuous reading unreachable by omission.
 */
export type PublishFootprint =
  | { scope: "environments"; environments: string[] }
  | { scope: "unscoped" }
  | { scope: "everywhere" };

/** The environment list a publish is judged over. THE one place that decides it. */
export function resolvePublishFootprint(
  context: Context,
  footprint: PublishFootprint | undefined,
  entity: {
    project?: string;
    targetingProjects?: string[];
    targetingAllProjects?: boolean;
  },
): string[] {
  // An adapter with no footprint concept scopes nothing — its changes have no
  // environment dimension, which is the same answer as `unscoped`.
  if (!footprint || footprint.scope === "unscoped") return [];
  if (footprint.scope === "everywhere") {
    return serveFootprint(getEnvironments(context.org), entity);
  }
  // A named-but-empty list is the vacuous case reintroduced from inside: the
  // adapter says it narrows, then narrows to nothing. Treat it as the reach it
  // could not enumerate rather than as permission to skip.
  return footprint.environments.length
    ? footprint.environments
    : serveFootprint(getEnvironments(context.org), entity);
}

/**
 * The footprint for a change that takes an entity OUT of service or returns it:
 * its own environment binding when it has one, otherwise everywhere it serves.
 *
 * Adapters and internal controllers both ask this, so it lives in one place —
 * `scoped` empty means unbound, and unbound means everywhere, never "nowhere".
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
