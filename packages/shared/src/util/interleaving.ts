import type { InterleavingInterface } from "../validators/interleaving";
import { validateJSONFeatureValue } from "./features";

// Parses a ranker config, requiring a JSON object, and validates it against the
// experiment's schema when one is enabled.
export function parseInterleavingRankerConfig(
  config: string,
  jsonSchema?: InterleavingInterface["jsonSchema"],
): Record<string, unknown> {
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
