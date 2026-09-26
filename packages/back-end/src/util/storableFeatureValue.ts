import { FeatureInterface } from "shared/types/feature";
import { validateFeatureValue } from "shared/util";
import { BadRequestError } from "back-end/src/util/errors";

// `validateFeatureValue` repairs loose JSON and returns the fix. The REST API
// stores what it was sent, so a value that needed repair is refused, naming
// the fix; the app repairs instead, where the user sees the fix before saving.
export function assertStorableFeatureValue(
  feature: Pick<FeatureInterface, "valueType" | "jsonSchema">,
  value: string,
  label: string,
): string {
  const repaired = validateFeatureValue(feature, value, label);
  if (repaired !== value) {
    throw new BadRequestError(
      `${label}: invalid JSON. Did you mean ${repaired.replace(/\s+/g, " ")}?`,
    );
  }
  return value;
}
