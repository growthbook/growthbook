import { Environment } from "shared/types/organization";

// Environments whose IDs match any of these patterns are considered
// non-production (dev-like). A feature enabled only in these environments
// is still treated as "draft" for status purposes.
export const NON_PRODUCTION_ENV_PATTERNS: RegExp[] = [
  /^(dev|staging|qa|pre|test|stage|stg|uat|local|homolog)/i,
];

export function isEnvironmentDevLike(envId: string): boolean {
  return NON_PRODUCTION_ENV_PATTERNS.some((re) => re.test(envId));
}

// The environment `id` is immutable and used as a reference key everywhere
// (feature rules, SDK connections, permissions, etc). `displayName` is a
// purely cosmetic, user-facing label — use this helper anywhere an
// environment's name is shown to a user so renames stay UI-only.
export function getEnvironmentDisplayName(
  env: Pick<Environment, "id" | "displayName">,
): string {
  return env.displayName || env.id;
}
