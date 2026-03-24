import { z } from "zod";
import { createBaseSchemaWithPrimaryKey } from "./base-model";

export const notificationCategorySchema = z.enum([
  "CHANGE",
  "MENTION",
  "REVIEW",
  "SYSTEM",
  "MARKETING",
  "INTEGRATION",
]);

export const notificationScopeSchema = z.enum(["user", "org", "project"]);

export const notificationResourceTypeSchema = z.enum([
  "feature",
  "experiment",
  "organization",
]);

export const notificationSourceSchema = z.enum([
  "watch",
  "auto",
  "rule",
  "marketing",
]);

export const userNotificationSchema = createBaseSchemaWithPrimaryKey({
  id: z.string(),
}).safeExtend({
  userId: z.string(),
  resourceType: notificationResourceTypeSchema,
  resourceId: z.string(),
  /** Optional project id for inbox filtering when the resource is project-scoped */
  projectId: z.string().optional(),
  category: notificationCategorySchema,
  eventType: z.string(),
  scope: notificationScopeSchema.optional(),
  title: z.string(),
  body: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
  source: notificationSourceSchema,
  seenAt: z.date().nullable().optional(),
  readAt: z.date().nullable().optional(),
  clickedAt: z.date().nullable().optional(),
  dismissedAt: z.date().nullable().optional(),
});

export type UserNotificationInterface = z.infer<typeof userNotificationSchema>;
