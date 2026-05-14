import { z } from "zod";

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
