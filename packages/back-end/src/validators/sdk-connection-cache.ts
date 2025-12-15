import { z } from "zod";
import { baseSchema } from "shared/validators";

export const sdkConnectionCacheValidator = baseSchema.extend({
  contents: z.string(),
});

export type SdkConnectionCacheInterface = z.infer<
  typeof sdkConnectionCacheValidator
>;
