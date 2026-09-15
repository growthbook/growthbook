import { ExperimentInterface } from "shared/types/experiment";
import { BadRequestError } from "back-end/src/util/errors";

type ReleasedVariationFields = Pick<
  ExperimentInterface,
  "releasedVariationId" | "variations"
>;

// A mismatched releasedVariationId silently drops the release from the SDK
// payload. Only a write that introduces the mismatch is rejected; a
// pre-existing one is left alone.
export function assertValidReleasedVariationId(
  updated: Partial<ReleasedVariationFields>,
  existing?: ReleasedVariationFields,
): void {
  const releasedVariationId = updated.releasedVariationId || "";
  if (!releasedVariationId) return;

  const variationIds = new Set((updated.variations ?? []).map((v) => v.id));
  if (variationIds.has(releasedVariationId)) return;

  const previousReleasedVariationId = existing?.releasedVariationId || "";
  const idChanged = previousReleasedVariationId !== releasedVariationId;
  const wasValid =
    !!existing && existing.variations.some((v) => v.id === releasedVariationId);

  if (idChanged || wasValid) {
    throw new BadRequestError(
      "invalid_released_variation_id: releasedVariationId must match one of the experiment's variation ids",
    );
  }
}
