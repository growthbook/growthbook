import { z } from "zod";

export const npsSurveyStatusValidator = z.enum(["responded", "dismissed"]);
export type NpsSurveyStatus = z.infer<typeof npsSurveyStatusValidator>;

// How the user left the survey after picking a score. Only "submitted" (an
// explicit "Send feedback" click) carries the comment text — every other exit
// records the score alone, never an unsent draft.
export const npsDispositionValidator = z.enum([
  "submitted",
  "skipped",
  "dismissed",
  "abandoned",
]);
export type NpsDisposition = z.infer<typeof npsDispositionValidator>;

// Request body for POST /user/nps-response, shared so the client and the
// endpoint can't drift into a silently rejected response.
export const npsResponseBodyValidator = z
  .object({
    status: npsSurveyStatusValidator,
    score: z.number().int().min(0).max(10).optional(),
    feedback: z.string().max(10000).optional(),
    disposition: npsDispositionValidator.optional(),
    // The disposition this response replaces, when a provisional report (e.g.
    // an "abandoned" flush the user then returned from) is superseded by an
    // explicit submit. Present so the update is recognisable as the same
    // response rather than a second one.
    supersedes: npsDispositionValidator.optional(),
    // Set by the `?show-nps` staff preview: still forwards to Slack so the
    // path stays testable, but doesn't consume the re-survey window.
    preview: z.boolean().optional(),
  })
  .refine((b) => b.status !== "responded" || b.score !== undefined, {
    message: "score is required when status is responded",
    path: ["score"],
  });

export type NpsResponseBody = z.infer<typeof npsResponseBodyValidator>;

export const userInterface = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    email: z.string(),
    verified: z.boolean(),
    passwordHash: z.string().optional(),
    superAdmin: z.boolean(),
    minTokenDate: z.date().optional(),
    agreedToTerms: z.boolean().optional(),
    npsSurveyStatus: npsSurveyStatusValidator.optional(),
    npsSurveyAt: z.date().optional(),
    dateCreated: z.date().optional(),
  })
  .strict();

export type UserInterface = z.infer<typeof userInterface>;

export const userLoginInterface = z
  .object({
    email: z.string(),
    id: z.string(),
    name: z.string(),
    ip: z.string(),
    userAgent: z.string(),
    os: z.string(),
    device: z.string(),
  })
  .strict();

export type UserLoginInterface = z.infer<typeof userLoginInterface>;
