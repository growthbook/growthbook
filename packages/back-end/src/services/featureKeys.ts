import { generateOpaqueFeatureKey } from "shared/util";
import { MAX_FEATURE_NAME_LENGTH } from "shared/constants";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getFeature } from "back-end/src/models/FeatureModel";
import { BadRequestError } from "back-end/src/util/errors";

// The key a new Feature Flag is created with. Orgs with `obfuscateFeatureKeys`
// get a generated opaque key and can't choose their own; everyone else must
// send one.
export async function resolveNewFeatureKey(
  context: ReqContext | ApiReqContext,
  requested: { id?: string; name?: unknown },
): Promise<string> {
  if (!context.org.settings?.obfuscateFeatureKeys) {
    if (typeof requested.id !== "string" || !requested.id) {
      throw new BadRequestError("Must specify feature key");
    }
    return requested.id;
  }

  if (requested.id) {
    throw new BadRequestError(
      "This organization generates Feature Flag keys. Omit `id` and send a `name`.",
    );
  }
  if (!cleanFeatureName(context, requested.name)) {
    throw new BadRequestError(
      "`name` is required because this organization generates Feature Flag keys.",
    );
  }

  for (let attempt = 0; attempt < 5; attempt++) {
    const key = generateOpaqueFeatureKey();
    if (!(await getFeature(context, key))) return key;
  }
  throw new Error("Could not generate a unique Feature Flag key. Try again.");
}

// Trims a Feature Flag name from a request. Orgs with opaque keys need the name
// to tell flags apart, so it can't be cleared there.
export function cleanFeatureName(
  context: ReqContext | ApiReqContext,
  name: unknown,
): string | undefined {
  if (name === undefined || name === null) return undefined;
  if (typeof name !== "string") {
    throw new BadRequestError("`name` must be a string.");
  }
  const trimmed = name.trim();
  if (trimmed.length > MAX_FEATURE_NAME_LENGTH) {
    throw new BadRequestError(
      `\`name\` can be at most ${MAX_FEATURE_NAME_LENGTH} characters.`,
    );
  }
  if (!trimmed && context.org.settings?.obfuscateFeatureKeys) {
    throw new BadRequestError(
      "`name` can't be empty because this organization generates Feature Flag keys.",
    );
  }
  return trimmed;
}
