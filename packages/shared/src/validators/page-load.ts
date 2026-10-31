import { z } from "zod";

// Milliseconds since the navigation began. Anything over ten minutes is not a
// page load worth reporting.
const ms = z.number().int().min(0).max(600_000);

const requestTimingValidator = z.strictObject({
  start: ms,
  end: ms,
  bytes: z.number().int().min(0).max(1_000_000_000).optional(),
});

// A browser's timings for one full page load of the dashboard
export const pageLoadValidator = z.strictObject({
  // Next.js route pattern such as "/features/[fid]", not the URL
  route: z
    .string()
    .max(100)
    .regex(/^\/[\w\-./[\]]*$/),
  navigationType: z.enum(["navigate", "reload", "back_forward", "prerender"]),
  // Short build sha, or empty when unknown
  build: z.string().regex(/^[\w.-]{0,40}$/),
  hiddenAt: ms.optional(),
  responseStart: ms,
  domContentLoaded: ms,
  pageMounted: ms,
  pageReady: ms.optional(),
  requests: z.strictObject({
    init: requestTimingValidator.optional(),
    authRefresh: requestTimingValidator.optional(),
    user: requestTimingValidator.optional(),
    organization: requestTimingValidator.optional(),
    definitions: requestTimingValidator.optional(),
    feature: requestTimingValidator.optional(),
  }),
});

export type PageLoadReport = z.infer<typeof pageLoadValidator>;
export type PageLoadRequestKey = keyof PageLoadReport["requests"];
