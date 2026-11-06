// Environments whose IDs match any of these patterns are considered
// non-production (dev-like). A feature enabled only in these environments
// is still treated as "draft" for status purposes.
export const NON_PRODUCTION_ENV_PATTERNS: RegExp[] = [
  /^(dev|staging|qa|pre|test|stage|stg|uat|local|homolog)/i,
];

export function isEnvironmentDevLike(envId: string): boolean {
  return NON_PRODUCTION_ENV_PATTERNS.some((re) => re.test(envId));
}

const NON_PRODUCTION_ENVIRONMENT_IDS = ["dev", "staging", "test"];

export function guessIsProductionEnvironment(envId: string): boolean {
  return !NON_PRODUCTION_ENVIRONMENT_IDS.includes(envId.toLowerCase());
}

export function isProductionEnvironment(env: {
  id: string;
  isProduction?: boolean;
}): boolean {
  return env.isProduction ?? guessIsProductionEnvironment(env.id);
}

export function withIsProduction<
  T extends { id: string; isProduction?: boolean },
>(env: T): T & { isProduction: boolean } {
  return { ...env, isProduction: isProductionEnvironment(env) };
}
