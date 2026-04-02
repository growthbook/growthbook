import { ReqContext } from "back-end/types/request";
import { getUserByEmail } from "back-end/src/models/UserModel";

/**
 * Resolves an owner input value (userId or email address) to a userId.
 *
 * - If `ownerInput` is empty/undefined, returns `undefined` (caller decides the fallback).
 * - If `ownerInput` looks like a userId (starts with "u_"), validates org membership and returns it.
 * - Otherwise treats `ownerInput` as an email, looks up the matching user, validates org membership,
 *   and returns their userId.
 *
 * Throws if the provided value does not resolve to an org member.
 */
export async function resolveOwnerToUserId(
  ownerInput: string | undefined,
  context: ReqContext,
): Promise<string | undefined> {
  if (!ownerInput) return undefined;

  if (ownerInput.startsWith("u_")) {
    const isMember = context.org.members.some((m) => m.id === ownerInput);
    if (!isMember) throw new Error(`Unable to find user: ${ownerInput}`);
    return ownerInput;
  }

  const user = await getUserByEmail(ownerInput);
  const isMember = context.org.members.some((m) => m.id === user?.id);
  if (!isMember || !user) {
    throw new Error(`Unable to find user: ${ownerInput}`);
  }
  return user.id;
}
