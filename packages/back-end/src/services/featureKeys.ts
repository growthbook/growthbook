import { generateOpaqueFeatureKey } from "shared/util";
import type { ReqContext } from "back-end/types/request";
import type { ApiReqContext } from "back-end/types/api";
import { getFeature } from "back-end/src/models/FeatureModel";
import { BadRequestError } from "back-end/src/util/errors";

// The key a new Feature Flag is created with. Orgs with `obfuscateFeatureKeys`
// get a generated opaque key and can't choose their own; everyone else must
// send one.
export async function resolveNewFeatureKey(
  context: ReqContext | ApiReqContext,
  requested: { id?: string; name?: string },
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
  if (!requested.name?.trim()) {
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
