import { OrganizationInterface } from "shared/types/organization";
import { GroupMap } from "shared/types/saved-group";
import { SavedGroupFormat } from "shared/types/sdk-connection";
import { SDKCapability } from "../types";
import { createInlineStrategy } from "./strategy-inline";
import { createReferencesV1Strategy } from "./strategy-references-v1";
import { createReferencesV2Strategy } from "./strategy-references-v2";
import { SavedGroupPayloadStrategy, SavedGroupRendering } from "./types";

/**
 * The format a connection's setting asks for, before capabilities are applied.
 * Connections created before the setting existed have only the old boolean.
 */
export function savedGroupFormatFromConnection(connection: {
  savedGroupFormat?: SavedGroupFormat;
  savedGroupReferencesEnabled?: boolean;
}): SavedGroupFormat {
  if (connection.savedGroupFormat) return connection.savedGroupFormat;
  return connection.savedGroupReferencesEnabled ? "referencesV1" : "inline";
}

/**
 * Keeps `savedGroupFormat` and the deprecated boolean in step on a write, in
 * whichever direction the caller supplied.
 *
 * Writing the boolean means a rollback to a build that only reads it keeps the
 * setting. Writing the format means a caller that still sends only the boolean
 * still changes what gets served, since reads prefer the format.
 *
 * `current` is the connection being edited, and is left out when creating one.
 */
export function withLegacySavedGroupFlag<
  T extends {
    savedGroupFormat?: SavedGroupFormat;
    savedGroupReferencesEnabled?: boolean;
  },
>(
  changes: T,
  current?: { savedGroupFormat?: SavedGroupFormat },
): T & {
  savedGroupFormat?: SavedGroupFormat;
  savedGroupReferencesEnabled?: boolean;
} {
  // The format wins when both are sent
  if (changes.savedGroupFormat) {
    return {
      ...changes,
      savedGroupReferencesEnabled: changes.savedGroupFormat !== "inline",
    };
  }

  if (changes.savedGroupReferencesEnabled === undefined) return changes;

  // Only the boolean was sent, so work out the format it means. Turning
  // references on for a connection already on one leaves it there: the boolean
  // cannot say which reference format was wanted, and picking v1 would
  // silently downgrade a v2 connection.
  const currentFormat = current?.savedGroupFormat;
  return {
    ...changes,
    savedGroupFormat: !changes.savedGroupReferencesEnabled
      ? "inline"
      : currentFormat && currentFormat !== "inline"
        ? currentFormat
        : "referencesV1",
  };
}

/**
 * Returns the format to write, given the connection's setting and what its SDK
 * can read.
 *
 * A format the SDK cannot read steps down to the next one: v2 to v1,
 * references to inline.
 */
export function resolveSavedGroupRendering({
  capabilities,
  savedGroupFormat,
  canInline = false,
}: {
  // undefined means there is no SDK connection. That covers previews and the
  // in-app evaluators, which keep the reference operators and pass the group
  // values in separately when they evaluate.
  capabilities?: SDKCapability[];
  // The connection's setting. Missing counts as inline.
  savedGroupFormat?: SavedGroupFormat;
  // Whether the caller has what inlining needs: the group map, and the
  // organization for attribute types. Without those, the safe fallback is to
  // leave the reference operators in place for a later pass to handle.
  canInline?: boolean;
}): SavedGroupRendering {
  if (capabilities === undefined) return "referencesV1";

  const wanted = savedGroupFormat ?? "inline";

  // v2 also needs the v1 capability. Every SDK with one has the other, and
  // asking for both means an SDK can never get v2 references in its conditions
  // with a v1 map to look them up in.
  if (
    wanted === "referencesV2" &&
    capabilities.includes("savedGroupReferencesV2") &&
    capabilities.includes("savedGroupReferences")
  ) {
    return "referencesV2";
  }

  // Either the setting is v1, or it is v2 and this SDK cannot read v2.
  if (wanted !== "inline" && capabilities.includes("savedGroupReferences")) {
    return "referencesV1";
  }

  return canInline ? "inline" : "referencesV1";
}

/**
 * Picks the format and returns the matching strategy, ready to use.
 *
 * Inlining needs the organization for attribute types, so leaving it out rules
 * inlining out. The strategy works that out itself, so callers do not have to.
 */
export function getSavedGroupPayloadStrategy({
  capabilities,
  savedGroupFormat,
  groupMap,
  organization,
}: {
  capabilities?: SDKCapability[];
  savedGroupFormat?: SavedGroupFormat;
  groupMap: GroupMap;
  organization?: OrganizationInterface;
}): SavedGroupPayloadStrategy {
  const rendering = resolveSavedGroupRendering({
    capabilities,
    savedGroupFormat,
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

/**
 * Removes saved group capabilities an SDK claims but cannot actually use.
 *
 * Remote-eval connections evaluate conditions in @growthbook/proxy-eval, which
 * does not know the `$savedGroup` operator yet, so they never get v2 whatever
 * SDK version they report.
 */
export function withoutUnsupportedSavedGroupCapabilities(
  capabilities: SDKCapability[],
  connection: { remoteEvalEnabled?: boolean },
): SDKCapability[] {
  if (!connection.remoteEvalEnabled) return capabilities;
  return capabilities.filter((c) => c !== "savedGroupReferencesV2");
}
