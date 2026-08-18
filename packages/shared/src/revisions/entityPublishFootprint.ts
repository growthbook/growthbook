// Specific files, not the package barrels: this module is imported by both apps
// and a barrel round-trip risks a runtime cycle.
import type { ConstantInterface } from "shared/types/constant";
import type { ConfigInterface } from "shared/types/config";
import {
  flipsArchivedState,
  proposedArchivedValue,
} from "../util/featureDraftPurity";
import {
  configPublishEnvironments,
  constantPublishEnvironments,
} from "../util/configs";
import { getConstantRevisionChange } from "./helpers";

/**
 * Distinguishes unscoped changes from changes affecting every served
 * environment; both would otherwise collapse to a permission-skipping empty list.
 */
export type PublishFootprint =
  | { scope: "environments"; environments: string[] }
  | { scope: "unscoped" }
  | { scope: "everywhere" };

export function constantPublishFootprint(
  snapshot: Pick<ConstantInterface, "value" | "environmentValues" | "archived">,
  proposedChanges: unknown,
): PublishFootprint {
  // An archive flip takes the constant out of service (or returns it)
  // everywhere it serves, so a dev-limited caller must not be able to land it.
  if (
    flipsArchivedState({
      proposed: proposedArchivedValue(proposedChanges),
      current: snapshot.archived,
    })
  ) {
    return { scope: "everywhere" };
  }
  const environments = constantPublishEnvironments(
    getConstantRevisionChange(snapshot, proposedChanges).changedEnvironments,
  );
  // A base-value or metadata change carries no intrinsic environment, so no
  // environment restriction applies — distinct from the archive flip above,
  // which reaches everywhere.
  return environments.length
    ? { scope: "environments", environments }
    : { scope: "unscoped" };
}

// A Config binds to the environments its scoped overrides name — the same
// list the controllers gate on. An empty footprint would pass every
// environment check vacuously, so never report one for a scoped Config.
export function configPublishFootprint(
  snapshot: Pick<ConfigInterface, "scopedConfig" | "archived">,
  proposedChanges: unknown,
): PublishFootprint {
  const environments = configPublishEnvironments(snapshot);
  if (environments.length) return { scope: "environments", environments };
  // A BASE Config binds to no environment. An archive flip on one still takes it
  // out of service everywhere it serves; any other change to it has no
  // environment dimension. Same split the Constant footprint makes.
  return flipsArchivedState({
    proposed: proposedArchivedValue(proposedChanges),
    current: snapshot.archived,
  })
    ? { scope: "everywhere" }
    : { scope: "unscoped" };
}

/**
 * The review authority a generic revision demands, resolved the same way the
 * server resolves publish authority, so the panel and the refusal agree.
 * `serving` is everywhere the entity can serve — what "everywhere" resolves to.
 */
export function entityReviewFootprint(
  footprint: PublishFootprint | undefined,
  serving: string[],
): { scope: "environments"; environments: string[] } | { scope: "unbound" } {
  if (!footprint || footprint.scope === "unscoped") return { scope: "unbound" };
  const environments =
    footprint.scope === "everywhere" || !footprint.environments.length
      ? serving
      : footprint.environments;
  return environments.length
    ? { scope: "environments", environments }
    : { scope: "unbound" };
}

export function entityPublishFootprint(
  type: string,
  snapshot: unknown,
  proposedChanges: unknown,
): PublishFootprint | undefined {
  if (type === "constant") {
    return constantPublishFootprint(
      snapshot as ConstantInterface,
      proposedChanges,
    );
  }
  if (type === "config") {
    return configPublishFootprint(snapshot as ConfigInterface, proposedChanges);
  }
  return undefined;
}
