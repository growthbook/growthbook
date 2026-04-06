import { ReqContext } from "back-end/types/request";

/**
 * Best-effort resolution of an owner input value (userId or email address) to a userId.
 *
 * - If `ownerInput` is empty/undefined, returns `undefined` (caller decides the fallback).
 * - If `ownerInput` looks like a userId (starts with "u_"), validates org membership and returns it.
 * - Otherwise treats `ownerInput` as an email, looks up the matching org member,
 *   and returns their userId if found. If the email does not resolve to an org member
 *   the original input is returned unchanged so existing API workflows are not broken.
 */
export async function resolveOwnerToUserId(
  ownerInput: string | undefined,
  context: ReqContext,
): Promise<string | undefined> {
  if (!ownerInput) return undefined;

  // Explicit userId — must be a valid org member.
  if (ownerInput.startsWith("u_")) {
    if (!context.org.members.some((m) => m.id === ownerInput)) {
      throw new Error(`Unable to find user: ${ownerInput}`);
    }
    return ownerInput;
  }

  // Email or legacy plain-name — best-effort resolution, never reject.
  // Old workflows may store display names (e.g. "Ben") in this field; we leave
  // those unchanged rather than breaking existing API calls.
  const user = await context.getUserByEmail(ownerInput);
  if (user && context.org.members.some((m) => m.id === user.id)) {
    return user.id;
  }
  return ownerInput;
}
