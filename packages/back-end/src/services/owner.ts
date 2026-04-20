import { ReqContext } from "back-end/types/request";

/**
 * Resolves an owner input value (userId or email address) to a userId.
 *
 * - If `ownerInput` is empty/undefined, returns `undefined` (caller decides the fallback).
 * - If `ownerInput` looks like a userId (starts with "u_"), validates org membership and returns it.
 * - Otherwise treats `ownerInput` as an email and looks up the matching org member:
 *   - If found, returns their userId.
 *   - If not found and `strict` is true, throws an error.
 *   - If not found and `strict` is false (default), returns the original input unchanged
 *     so existing API workflows that store display names or emails are not broken.
 */
export async function resolveOwnerToUserId(
  ownerInput: string | undefined,
  context: ReqContext,
  { strict = false }: { strict?: boolean } = {},
): Promise<string | undefined> {
  if (!ownerInput) return undefined;

  // Explicit userId — must be a valid org member.
  if (ownerInput.startsWith("u_")) {
    if (!context.org.members.some((m) => m.id === ownerInput)) {
      throw new Error(`Unable to find user: ${ownerInput}`);
    }
    return ownerInput;
  }

  // Email — resolve to userId if possible.
  const user = await context.getUserByEmail(ownerInput);
  if (user && context.org.members.some((m) => m.id === user.id)) {
    return user.id;
  }
  if (strict) {
    throw new Error(`Unable to find user: ${ownerInput}`);
  }
  // Non-strict: leave legacy display names / unresolvable emails unchanged.
  return ownerInput;
}
