import { z } from "zod";
import { baseSchema } from "./base-model";

export const watchSchema = baseSchema.safeExtend({
  userId: z.string(),
  experiments: z.array(z.string()),
  features: z.array(z.string()),
});

export type WatchInterface = z.infer<typeof watchSchema>;

export const updateWatchSchema = z.strictObject({
  userId: z.string(),
  type: z.enum(["experiments", "features"]),
  item: z.string(),
});

export type UpdateWatchOptions = z.infer<typeof updateWatchSchema>;
