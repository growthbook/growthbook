import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";
import { notificationCategorySchema } from "./user-notification";

export const categoryChannelPrefsSchema = z.strictObject({
  inApp: z.boolean(),
  email: z.boolean().optional(),
  slack: z.boolean().optional(),
});

export const notificationPreferencesSchema = createBaseSchemaWithPrimaryKey({
  userId: z.string(),
  organization: z.string(),
}).safeExtend({
  categories: z
    .record(notificationCategorySchema, categoryChannelPrefsSchema)
    .optional(),
  digestFrequency: z.enum(["instant", "daily", "weekly"]).optional(),
});

export type NotificationPreferencesInterface = z.infer<
  typeof notificationPreferencesSchema
>;

export const notificationPreferencesPatchSchema = z.strictObject({
  categories: z
    .record(notificationCategorySchema, categoryChannelPrefsSchema.partial())
    .optional(),
  digestFrequency: z.enum(["instant", "daily", "weekly"]).optional(),
});

export type NotificationPreferencesPatch = z.infer<
  typeof notificationPreferencesPatchSchema
>;
