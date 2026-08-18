// Specific files, not barrels: imported by both apps, so a barrel risks a cycle.
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

// "unscoped" and "everywhere" both collapse to an empty env list, which would
// skip the permission check — so they stay distinct.
export type PublishFootprint =
  | { scope: "environments"; environments: string[] }
  | { scope: "unscoped" }
  | { scope: "everywhere" };

export function constantPublishFootprint(
  snapshot: Pick<ConstantInterface, "value" | "environmentValues" | "archived">,
  proposedChanges: unknown,
): PublishFootprint {
  // Archiving pulls it out of service everywhere it serves.
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
  return environments.length
    ? { scope: "environments", environments }
    : { scope: "unscoped" };
}

// A Config binds to the environments its scoped overrides name.
export function configPublishFootprint(
  snapshot: Pick<ConfigInterface, "scopedConfig" | "archived">,
  proposedChanges: unknown,
): PublishFootprint {
  const environments = configPublishEnvironments(snapshot);
  if (environments.length) return { scope: "environments", environments };
  // A base Config binds to no environment; archiving it still reaches everywhere.
  return flipsArchivedState({
    proposed: proposedArchivedValue(proposedChanges),
    current: snapshot.archived,
  })
    ? { scope: "everywhere" }
    : { scope: "unscoped" };
}

// Resolved the same way the server resolves publish authority, so the panel and
// the refusal agree. `serving` is what "everywhere" resolves to.
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
