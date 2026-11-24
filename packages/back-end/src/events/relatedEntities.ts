import isEqual from "lodash/isEqual";
import { EventRelatedEntity } from "shared/validators";
import { ruleFootprint } from "shared/util";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { OrganizationInterface } from "shared/types/organization";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

type ExperimentRefRule = Extract<FeatureRule, { type: "experiment-ref" }>;

function asExperimentRef(rule?: FeatureRule): ExperimentRefRule | undefined {
  return rule?.type === "experiment-ref" ? rule : undefined;
}

function ruleIsLive(
  feature: FeatureInterface,
  rule: FeatureRule,
  env: string,
  allowedEnvs: string[],
): boolean {
  return (
    !feature.archived &&
    !!feature.environmentSettings?.[env]?.enabled &&
    !!rule.enabled &&
    ruleFootprint(rule, allowedEnvs).includes(env)
  );
}

function toEntities(
  type: "feature" | "experiment",
  envsById: Map<string, Set<string>>,
  allowedEnvs: string[],
): EventRelatedEntity[] {
  return [...envsById.entries()]
    .map(([id, envs]) => ({
      type,
      id,
      environments: allowedEnvs.filter((e) => envs.has(e)),
    }))
    .filter((entity) => entity.environments.length > 0);
}

// Experiments a flag change touched: their own rule changed, or a toggle or
// archive switched that rule on or off. Rules that only moved are not listed.
export function getChangedExperimentEntities(
  previous: FeatureInterface,
  current: FeatureInterface,
  changedEnvs: string[],
  allowedEnvs: string[],
): EventRelatedEntity[] {
  const envsByExperiment = new Map<string, Set<string>>();
  const record = (
    before: ExperimentRefRule | undefined,
    after: ExperimentRefRule | undefined,
  ) => {
    const experimentId = (after ?? before)?.experimentId;
    if (!experimentId) return;
    const ruleChanged = !isEqual(before, after);
    for (const env of changedEnvs) {
      const wasLive =
        !!before && ruleIsLive(previous, before, env, allowedEnvs);
      const isLive = !!after && ruleIsLive(current, after, env, allowedEnvs);
      if (wasLive !== isLive || (ruleChanged && (wasLive || isLive))) {
        const envs = envsByExperiment.get(experimentId) ?? new Set();
        envs.add(env);
        envsByExperiment.set(experimentId, envs);
      }
    }
  };

  const previousRules = new Map(
    (previous.rules ?? []).map((r) => [r.id, r] as const),
  );
  const currentRules = new Map(
    (current.rules ?? []).map((r) => [r.id, r] as const),
  );
  for (const id of new Set([...previousRules.keys(), ...currentRules.keys()])) {
    const before = asExperimentRef(previousRules.get(id));
    const after = asExperimentRef(currentRules.get(id));
    if (before && after && before.experimentId !== after.experimentId) {
      record(before, undefined);
      record(undefined, after);
    } else {
      record(before, after);
    }
  }
  return toEntities("experiment", envsByExperiment, allowedEnvs);
}

export function getExperimentRunEnvironments(
  experimentId: string,
  feature: FeatureInterface,
  allowedEnvs: string[],
): string[] {
  const rules = (feature.rules ?? []).filter(
    (r) => asExperimentRef(r)?.experimentId === experimentId,
  );
  return allowedEnvs.filter((env) =>
    rules.some((rule) => ruleIsLive(feature, rule, env, allowedEnvs)),
  );
}

export function getExperimentFlagEntities(
  experimentId: string,
  linkedFeatures: FeatureInterface[],
  allowedEnvs: string[],
): EventRelatedEntity[] {
  return toEntities(
    "feature",
    new Map(
      linkedFeatures.map((f) => [
        f.id,
        new Set(getExperimentRunEnvironments(experimentId, f, allowedEnvs)),
      ]),
    ),
    allowedEnvs,
  );
}

export function getDependentEntities(
  {
    features,
    experiments = [],
  }: {
    features: FeatureInterface[];
    experiments?: { id: string; linkedFeatures?: string[] }[];
  },
  allowedEnvs: string[],
  featuresById: Map<string, FeatureInterface> = new Map(),
): EventRelatedEntity[] {
  const featureEntities = toEntities(
    "feature",
    new Map(
      features.map((f) => [f.id, getEnabledEnvironments(f, allowedEnvs)]),
    ),
    allowedEnvs,
  );
  const experimentEntities = toEntities(
    "experiment",
    new Map(
      experiments.map((experiment) => [
        experiment.id,
        new Set(
          (experiment.linkedFeatures ?? []).flatMap((featureId) => {
            const feature = featuresById.get(featureId);
            return feature
              ? getExperimentRunEnvironments(
                  experiment.id,
                  feature,
                  allowedEnvs,
                )
              : [];
          }),
        ),
      ]),
    ),
    allowedEnvs,
  );
  return [...featureEntities, ...experimentEntities];
}

// What a saved group, constant or config change reaches, for its event.
export type EventReach = {
  environments: string[];
  relatedEntities: EventRelatedEntity[];
};

export const NO_REACH: EventReach = { environments: [], relatedEntities: [] };

export function payloadKeysReach(
  payloadKeys: { environment: string }[],
  relatedEntities: EventRelatedEntity[],
  allowedEnvs: string[],
): EventReach {
  const envs = new Set(payloadKeys.map((k) => k.environment));
  return {
    environments: allowedEnvs.filter((e) => envs.has(e)),
    relatedEntities,
  };
}

// Runs a refresh scan, then hands the change's event what it reaches: every
// environment when the scan fails or falls back.
export async function refreshThenReport(
  org: OrganizationInterface,
  refresh: () => Promise<EventReach | null>,
  onReach?: (reach: EventReach) => Promise<unknown>,
): Promise<void> {
  let reach: EventReach | null = null;
  try {
    reach = await refresh();
  } finally {
    await onReach?.(
      reach ?? {
        environments: getEnvironmentIdsFromOrg(org),
        relatedEntities: [],
      },
    );
  }
}
