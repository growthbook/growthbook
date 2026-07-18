// Environments whose IDs match any of these patterns are considered
// non-production (dev-like). A feature enabled only in these environments
// is still treated as "draft" for status purposes.
export const NON_PRODUCTION_ENV_PATTERNS: RegExp[] = [
  /^(dev|staging|qa|pre|test|stage|stg|uat|local|homolog)/i,
];

export function isEnvironmentDevLike(envId: string): boolean {
  return NON_PRODUCTION_ENV_PATTERNS.some((re) => re.test(envId));
}
