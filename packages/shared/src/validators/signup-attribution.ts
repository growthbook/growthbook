import { z } from "zod";

const attributionFields = {
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
  gclid: z.string().optional(),
  li_fat_id: z.string().optional(),
  fbclid: z.string().optional(),
  msclkid: z.string().optional(),
  referrer: z.string().optional(),
  landing_page: z.string().optional(),
  touch_at: z.string().optional(),
};

export const attributionCookieSchema = z
  .object(attributionFields)
  .passthrough(); // Prevents new keys from breaking the cookie

export type AttributionCookie = z.infer<typeof attributionCookieSchema>;

// Stored on the organization document at creation. Same fields as the
// cookie, but unknown keys are stripped.
export const signupAttributionSchema = z.object(attributionFields);

export type SignupAttribution = z.infer<typeof signupAttributionSchema>;

export const signupAttributionPayloadSchema = z
  .object({
    organizationId: z.string(),
    userId: z.string(),
    email: z.string(),
    emailType: z.enum(["free", "business"]),
    attribution: attributionCookieSchema,
  })
  .strict();

export type SignupAttributionPayload = z.infer<
  typeof signupAttributionPayloadSchema
>;
