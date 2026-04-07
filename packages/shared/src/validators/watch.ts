import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

export const watchSchema = createBaseSchemaWithPrimaryKey({
  userId: z.string(),
  organization: z.string(),
}).safeExtend({
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
