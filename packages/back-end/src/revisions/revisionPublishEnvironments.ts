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
/**
 * What a change's environment reach IS — stated by the adapter, not inferred from
 * an empty list.
 *
 * The permission layer ends in `envs.every(...)`, so `[]` is vacuously true: an
 * empty footprint ALLOWS every environment rather than checking them. Two entirely
 * different situations were both spelled `[]`:
 *
 *  - `unscoped`  — the change has no environment dimension at all. A Constant's
 *                  base value is declared design: it carries no intrinsic
 *                  environment, so the restriction does not apply and a
 *                  dev-limited editor may change it.
 *  - `everywhere` — the change reaches every environment the entity serves, and
 *                  simply names none of its own. An archive flip is the case: it
 *                  takes the entity out of service everywhere, and read as `[]` it
 *                  let a dev-limited caller archive production.
 *
 * Collapsing those two into "empty" is what made the second one invisible, and
 * each adapter had to remember to special-case it. Naming them makes the vacuous
 * reading unreachable by omission: an adapter must say which it means, and a new
 * entity type cannot inherit the hazard by writing nothing.
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
