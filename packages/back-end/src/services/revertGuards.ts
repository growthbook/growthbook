import type { FeatureInterface } from "shared/types/feature";
import {
  getRevertValueValidationWarnings,
  type MergeResultChanges,
} from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { isArchiveTransition } from "back-end/src/revisions/archiveTransition";
import { assertFeatureMoveDependentsGuard } from "back-end/src/services/moveDependentsGuard";
import { assertFeatureArchiveDependentsGuard } from "back-end/src/services/archiveDependentsGuard";
import { SoftWarningError } from "back-end/src/util/errors";

// The checks every landing revert shares, so the dashboard and the REST routes
// gate a revert the same way.

// Restoring an archived state needs revert authority over the serving
// environments; restoring "archived" also takes the flag out of service, so it
// carries the delete-class gate archiving it any other way does.
export function assertCanRevertArchived(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  targetArchived: boolean,
  environments: string[],
): void {
  if (!context.permissions.canRevertFeature(feature, environments)) {
    context.permissions.throwPermissionError();
  }
  if (
    isArchiveTransition({
      proposed: targetArchived,
      current: feature.archived,
    }) &&
    !context.permissions.canDeleteFeature(feature, environments)
  ) {
    context.permissions.throwPermissionError();
  }
}

// Restored values the current schema / value type can no longer read are a
// bypassable soft warning (ignoreWarnings) rather than a blind publish.
export function assertRevertValuesReadable(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  changes: Pick<MergeResultChanges, "defaultValue" | "rules" | "metadata">,
): void {
  const warnings = getRevertValueValidationWarnings(feature, changes);
  if (warnings.length && !context.ignoreWarnings) {
    throw new SoftWarningError(
      "Reverting to this revision restores values that no longer pass validation:\n" +
        warnings.join("\n"),
      warnings,
    );
  }
}

// The dependents guards a landing revert runs: a project move, and a restore
// that re-archives the flag.
export async function assertRevertLandingGuards(
  context: ReqContext | ApiReqContext,
  feature: FeatureInterface,
  changes: Pick<MergeResultChanges, "metadata" | "archived">,
): Promise<void> {
  await assertFeatureMoveDependentsGuard(context, feature, changes.metadata);
  if (changes.archived === true && !feature.archived) {
    await assertFeatureArchiveDependentsGuard(context, feature);
  }
}
