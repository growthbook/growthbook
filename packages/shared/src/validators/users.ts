import { z } from "zod";
import { NPS_MAX_FEEDBACK_LENGTH } from "../nps";

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
    feedback: z.string().max(NPS_MAX_FEEDBACK_LENGTH).optional(),
    disposition: npsDispositionValidator.optional(),
    // Set by the `?show-nps` staff preview: still forwards to Slack so the
    // path stays testable, but doesn't consume the re-survey window.
    preview: z.boolean().optional(),
  })
  .refine((b) => b.status !== "responded" || b.score !== undefined, {
    message: "score is required when status is responded",
    path: ["score"],
  });

export type NpsResponseBody = z.infer<typeof npsResponseBodyValidator>;

export const SUPER_ADMIN_PERMISSIONS = [
  "view",
  "impersonate",
  "sso",
  "billing",
  "messages",
  "provision",
  "metadata",
  "suspend",
  "create",
  "users",
  "grant",
] as const;

export const superAdminPermissionValidator = z.enum(SUPER_ADMIN_PERMISSIONS);
export type SuperAdminPermission = z.infer<
  typeof superAdminPermissionValidator
>;

// `true` is full access; an array grants only the listed permissions
export const superAdminValidator = z.union([
  z.boolean(),
  z.array(superAdminPermissionValidator),
]);
export type SuperAdmin = z.infer<typeof superAdminValidator>;

export const userInterface = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    email: z.string(),
    verified: z.boolean(),
    // IdP `sub` this user must sign in with on Cloud's default login; "" or missing means unbound
    authSubject: z.string().optional(),
    passwordHash: z.string().optional(),
    superAdmin: superAdminValidator,
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
