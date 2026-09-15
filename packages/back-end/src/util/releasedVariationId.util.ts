import { ExperimentInterface } from "shared/types/experiment";
import { BadRequestError } from "back-end/src/util/errors";

type ReleasedVariationFields = Pick<
  ExperimentInterface,
  "releasedVariationId" | "variations"
>;

// A `releasedVariationId` that matches none of the experiment's variations
// silently loses the release in the SDK payload, so we should assert it is
// valid. Every writer funnels through
// `createExperiment` / `updateExperiment`, so the check lives there.
//
// It only rejects a write that introduces the mismatch, never one that leaves
// an existing mismatch in place:
//   1. the released id changes and the new value is not a variation id, or
//   2. the released id used to be a variation id and the write removes it.
export function assertValidReleasedVariationId(
  updated: Partial<ReleasedVariationFields>,
  existing?: ReleasedVariationFields,
): void {
  const releasedVariationId = updated.releasedVariationId || "";
  if (!releasedVariationId) return;

  const variationIds = new Set((updated.variations ?? []).map((v) => v.id));
  if (variationIds.has(releasedVariationId)) return;

  // Reaching here means there is a released variation ID in the model,
  //but it doesn't match any of the variation IDs in the model.
  const previousReleasedVariationId = existing?.releasedVariationId || "";
  const idChanged = previousReleasedVariationId !== releasedVariationId;
  const wasValid =
    !!existing && existing.variations.some((v) => v.id === releasedVariationId);

  // But we should only throw if the released variation ID changed or was valid (implying
  // that the caller is likely changing variation IDs without updating the released variation ID).
  if (idChanged || wasValid) {
    throw new BadRequestError(
      "invalid_released_variation_id: releasedVariationId must match one of the experiment's variation ids",
    );
  }
}
