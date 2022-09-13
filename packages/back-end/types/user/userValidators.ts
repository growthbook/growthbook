import * as z from "zod";

export const vUserInterface = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  verified: z.boolean(),
  passwordHash: z.string().optional(),
  admin: z.boolean(),
});

export const vUserRef = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});
