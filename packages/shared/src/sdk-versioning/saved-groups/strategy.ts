import { OrganizationInterface } from "shared/types/organization";
import { GroupMap } from "shared/types/saved-group";
import { SDKCapability } from "../types";
import { createInlineStrategy } from "./strategy-inline";
import { createReferencesV1Strategy } from "./strategy-references-v1";
import { createReferencesV2Strategy } from "./strategy-references-v2";
import { SavedGroupPayloadStrategy, SavedGroupRendering } from "./types";

/** Returns the format name for a given set of capabilities and settings. */
export function resolveSavedGroupRendering({
  capabilities,
  savedGroupReferencesEnabled,
  canInline = false,
}: {
  // undefined means there is no SDK connection. That covers previews and the
  // in-app evaluators, which keep the reference operators and pass the group
  // values in separately when they evaluate.
  capabilities?: SDKCapability[];
  // The connection's setting. Missing counts as off.
  savedGroupReferencesEnabled?: boolean;
  // Whether the caller has what inlining needs: the group map, and the
  // organization for attribute types. Without those, the safe fallback is to
  // leave the reference operators in place for a later pass to handle.
  canInline?: boolean;
}): SavedGroupRendering {
  if (capabilities === undefined) return "referencesV1";

  // v2 also needs the v1 capability. Every SDK with one has the other, and
  // asking for both means an SDK can never get v2 references in its conditions
  // with a v1 map to look them up in.
  const referencesEnabled =
    savedGroupReferencesEnabled === true &&
    capabilities.includes("savedGroupReferences");

  if (!referencesEnabled) return canInline ? "inline" : "referencesV1";

  return capabilities.includes("savedGroupReferencesV2")
    ? "referencesV2"
    : "referencesV1";
}

/**
 * Picks the format and returns the matching strategy, ready to use.
 *
 * Inlining needs the organization for attribute types, so leaving it out rules
 * inlining out. The strategy works that out itself, so callers do not have to.
 */
export function getSavedGroupPayloadStrategy({
  capabilities,
  savedGroupReferencesEnabled,
  groupMap,
  organization,
}: {
  capabilities?: SDKCapability[];
  savedGroupReferencesEnabled?: boolean;
  groupMap: GroupMap;
  organization?: OrganizationInterface;
}): SavedGroupPayloadStrategy {
  const rendering = resolveSavedGroupRendering({
    capabilities,
    savedGroupReferencesEnabled,
    canInline: !!organization,
  });

  // Checking `organization` again is not needed, since `inline` only comes
  // back when `canInline` was true. It is here so TypeScript can narrow the
  // type without a cast.
  if (rendering === "inline" && organization) {
    return createInlineStrategy(groupMap, organization);
  }
  if (rendering === "referencesV2") {
    return createReferencesV2Strategy(
      groupMap,
      capabilities ?? [],
      organization,
    );
  }
  return createReferencesV1Strategy(groupMap, organization);
}
