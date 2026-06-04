import type { Environment } from "shared/types/organization";

/**
 * Environment IDs the rule currently targets for UI that depends on scope
 * (prerequisite checks, previews, etc.).
 */
export function getEffectiveEnvironmentIds(
  scopeAllEnvs: boolean,
  selectedEnvironmentIds: string[],
  featureEnvironments: Environment[],
): string[] {
  return scopeAllEnvs
    ? featureEnvironments.map((e) => e.id)
    : selectedEnvironmentIds;
}

/**
 * `environments` array for POST / PUT feature rule endpoints — always derived
 * from Rule Environments state, never from the page env tab.
 */
export function getFeatureRuleRequestEnvironmentIds(
  scopeAllEnvs: boolean,
  selectedEnvironmentIds: string[],
  featureEnvironments: Environment[],
): string[] {
  return getEffectiveEnvironmentIds(
    scopeAllEnvs,
    selectedEnvironmentIds,
    featureEnvironments,
  );
}

/**
 * Single env id when scope is "specific" and exactly one env is selected.
 * Used for PUT /safe-rollout/:id (body.environment) and anywhere else a
 * string id is required.
 */
export function getPinnedSingleEnvironmentId(
  scopeAllEnvs: boolean,
  selectedEnvironmentIds: string[],
): string | undefined {
  if (scopeAllEnvs) return undefined;
  if (selectedEnvironmentIds.length !== 1) return undefined;
  const id = selectedEnvironmentIds[0]?.trim();
  return id || undefined;
}
