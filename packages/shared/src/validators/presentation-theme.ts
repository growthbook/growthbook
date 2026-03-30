import { z } from "zod";

const presentationTransitionValidator = z.enum(["none", "fade", "slide"]);
const presentationCelebrationValidator = z.enum([
  "none",
  "confetti",
  "emoji",
  "stars",
  "random",
  "cash",
]);

const presentationCustomThemeValidator = z
  .object({
    backgroundColor: z.string().optional(),
    textColor: z.string().optional(),
    headingFont: z.string().optional(),
    bodyFont: z.string().optional(),
    logoUrl: z.string().optional(),
    transition: presentationTransitionValidator.optional(),
    celebration: presentationCelebrationValidator.optional(),
  })
  .strict();

export const presentationThemeValidator = z
  .object({
    id: z.string(),
    organization: z.string(),
    userId: z.string(),
    name: z.string(),
    customTheme: presentationCustomThemeValidator,
    dateCreated: z.date(),
    dateUpdated: z.date(),
  })
  .strict();
