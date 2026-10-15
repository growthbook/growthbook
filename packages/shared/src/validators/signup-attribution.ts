import { z } from "zod";

export const attributionTouchSchema = z
  .object({
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
  })
  .passthrough(); // Prevents new keys from breaking the cookie

// Top-level fields are the last touch. first_touch is set on the first visit
// and never overwritten. It's missing on cookies written before it existed,
// and a malformed value is dropped rather than failing the whole cookie.
export const attributionCookieSchema = attributionTouchSchema
  .extend({
    first_touch: attributionTouchSchema.optional().catch(undefined),
  })
  .passthrough();

export type AttributionCookie = z.infer<typeof attributionCookieSchema>;

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
