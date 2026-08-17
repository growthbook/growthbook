import { OrganizationSettings, RequireReview } from "shared/types/organization";
import {
  RevisionFields,
  getDraftAffectedEnvironments,
  revisionHasMetadataOnlyGlobalChange,
} from "./features";

// What a reviewer must hold authority over to sanction a draft.
export type ReviewAuthorityFootprint =
  | { scope: "environments"; environments: string[] }
  | { scope: "everywhere" }
  // Metadata with no environment binding. Requires authority no environment
  // limit restricts, since an empty environment list would pass vacuously.
  | { scope: "unbound" };

function requiresMetadataReview(settings?: OrganizationSettings): boolean {
  const requireReviews = settings?.requireReviews;
  if (!Array.isArray(requireReviews)) return !!requireReviews;
  return requireReviews.some(
    (rule: RequireReview) =>
      rule.requireReviewOn && rule.featureRequireMetadataReview !== false,
  );
}

/**
 * The environments a reviewer needs authority in to approve this draft.
 *
 * `bases` takes every state the draft could be measured against — the live
 * revision and the draft's base — because those two can disagree. Unioning
 * means drift can only ever demand more authority, never less.
 */
export function getReviewAuthorityFootprint({
  revision,
  bases,
  allEnvironments,
  settings,
  liveRampScheduleEnvs,
}: {
  revision: RevisionFields;
  bases: RevisionFields[];
  allEnvironments: string[];
  settings?: OrganizationSettings;
  liveRampScheduleEnvs?: Map<string, string[] | "all">;
}): ReviewAuthorityFootprint {
  const environments = new Set<string>();
  let metadataOnlyGlobal = false;

  for (const base of bases) {
    const affected = getDraftAffectedEnvironments(
      revision,
      base,
      allEnvironments,
      liveRampScheduleEnvs,
    );

    if (affected !== "all") {
      affected.forEach((env) => environments.add(env));
      continue;
    }

    // A global change that is not purely metadata reaches live state in every
    // environment, so nothing narrower can sanction it.
    if (!revisionHasMetadataOnlyGlobalChange(revision, base)) {
      return { scope: "everywhere" };
    }
    metadataOnlyGlobal = true;
  }

  if (metadataOnlyGlobal && requiresMetadataReview(settings)) {
    return { scope: "unbound" };
  }

  return { scope: "environments", environments: [...environments] };
}
