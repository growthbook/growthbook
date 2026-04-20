/**
 * Pure helper for attaching a resolved `ownerEmail` to an API-shaped doc.
 *
 * Lives in its own module (no DB/model imports) so that `to*ApiInterface`
 * converters can statically import it without pulling UserModel into their
 * dependency graph — some of those converters sit in modules that would
 * otherwise form load-time cycles with UserModel → services/users →
 * services/auth → BaseModel → services/context → services/experiments.
 *
 * The sibling module `./ownerEmail` re-exports this from the same path so
 * call-sites can keep using `import { withOwnerEmail } from ".../ownerEmail"`.
 */
export function withOwnerEmail<T extends object>(
  apiDoc: T,
  map: Map<string, string | undefined> | undefined,
): T {
  if (!map) return apiDoc;
  if (!("owner" in apiDoc) || typeof apiDoc.owner !== "string") return apiDoc;
  const email = map.get(apiDoc.owner);
  if (email === undefined) return apiDoc;
  return { ...apiDoc, ownerEmail: email };
}
