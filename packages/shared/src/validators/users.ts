import { z } from "zod";

// Super admin can be:
//   - `false` (or unset) — not a super admin
//   - `true` — full super admin access (read + write)
//   - `"readonly"` — super admin who can read everything but cannot perform
//     super-admin writes (disable orgs, edit SSO, mark other users as
//     super admin, etc.)
export const superAdminSchema = z.union([z.boolean(), z.literal("readonly")]);
export type SuperAdmin = z.infer<typeof superAdminSchema>;

// Truthy for any super admin (full or readonly).
export function isSuperAdmin(value: SuperAdmin | undefined): boolean {
  return value === true || value === "readonly";
}

// Only true for full super admins — used to gate super-admin write actions.
export function canSuperAdminWrite(value: SuperAdmin | undefined): boolean {
  return value === true;
}

export const userInterface = z
  .object({
    id: z.string(),
    name: z.string().optional(),
    email: z.string(),
    verified: z.boolean(),
    passwordHash: z.string().optional(),
    superAdmin: superAdminSchema,
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
