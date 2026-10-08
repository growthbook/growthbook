import type { InterleavingInterface } from "../validators/interleaving";
import { getValidation, validateJSONFeatureValue } from "./features";

// `getValidation` turns an unparseable schema into "validation disabled", so an
// enabled schema that doesn't parse would silently accept every config.
export function assertUsableRankerSchema(
  jsonSchema?: InterleavingInterface["jsonSchema"],
): void {
  if (!jsonSchema?.enabled) return;
  if (!getValidation({ jsonSchema }).validationEnabled) {
    throw new Error(
      "Ranker config schema is invalid, so ranker configs cannot be validated.",
    );
  }
}

export function parseInterleavingRankerConfig(
  config: string,
  jsonSchema?: InterleavingInterface["jsonSchema"],
): Record<string, unknown> {
  assertUsableRankerSchema(jsonSchema);
  let parsed: unknown;
  try {
    parsed = JSON.parse(config);
  } catch (e) {
    throw new Error(
      `Ranker config must be valid JSON: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Ranker config must be a JSON object");
  }
  // Not validateFeatureValue: it also resolves `$extends`/`@config:`, which
  // nothing on the interleaving payload path reads.
  const { valid, errors } = validateJSONFeatureValue(parsed, {
    jsonSchema: jsonSchema ?? undefined,
  });
  if (!valid) {
    throw new Error(errors.join(", "));
  }
  return parsed as Record<string, unknown>;
}
