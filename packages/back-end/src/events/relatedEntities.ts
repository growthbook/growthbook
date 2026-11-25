import { AsyncLocalStorage } from "async_hooks";
import isEqual from "lodash/isEqual";
import { EventRelatedEntity } from "shared/validators";
import { resolveTargetingProjectIds, ruleFootprint } from "shared/util";
import { FeatureInterface, FeatureRule } from "shared/types/feature";
import { OrganizationInterface } from "shared/types/organization";
import { getEnabledEnvironments } from "back-end/src/util/features";
import { getEnvironmentIdsFromOrg } from "back-end/src/util/organization.util";

// What caused the writes running inside, such as a ramp step, for their events.
const causes = new AsyncLocalStorage<EventRelatedEntity[]>();

export function runWithRelatedEntities<T>(
  entities: EventRelatedEntity[],
  run: () => Promise<T>,
): Promise<T> {
  return causes.run(entities, run);
}

export function currentRelatedEntities(): EventRelatedEntity[] {
  return causes.getStore() ?? [];
}

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

// The org's environments and Projects, which related entities are listed in.
export type OrgScope = { environments: string[]; projectIds: string[] };

type Reach = {
  environments: Iterable<string>;
  projects?: string[];
  tags?: string[];
};

function toEntities(
  type: "feature" | "experiment",
  reachById: Map<string, Reach>,
  allowedEnvs: string[],
): EventRelatedEntity[] {
  return [...reachById.entries()]
    .map(([id, reach]) => {
      const envs = new Set(reach.environments);
      return {
        type,
        id,
        environments: allowedEnvs.filter((e) => envs.has(e)),
        ...(reach.projects ? { projects: reach.projects } : {}),
        ...(reach.tags ? { tags: reach.tags } : {}),
      };
    })
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
  return toEntities(
    "experiment",
    new Map(
      [...envsByExperiment].map(([id, environments]) => [id, { environments }]),
    ),
    allowedEnvs,
  );
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

function flagReach(
  experimentId: string,
  feature: FeatureInterface,
  scope: OrgScope,
): Reach {
  return {
    environments: getExperimentRunEnvironments(
      experimentId,
      feature,
      scope.environments,
    ),
    projects: resolveTargetingProjectIds(feature, scope.projectIds),
    tags: feature.tags ?? [],
  };
}

// Visual changes and URL redirects are served in every environment; otherwise
// an experiment reaches where its linked flags run it.
export function getExperimentReach(
  experimentId: string,
  servedEverywhere: boolean,
  linkedFeatures: FeatureInterface[],
  scope: OrgScope,
): EventReach {
  const relatedEntities = toEntities(
    "feature",
    new Map(
      linkedFeatures.map((f) => [f.id, flagReach(experimentId, f, scope)]),
    ),
    scope.environments,
  );
  const envs = new Set(
    relatedEntities.flatMap((e) => ("environments" in e ? e.environments : [])),
  );
  return {
    environments: servedEverywhere
      ? scope.environments
      : scope.environments.filter((e) => envs.has(e)),
    relatedEntities,
  };
}

type DependentExperiment = {
  id: string;
  project?: string;
  tags?: string[];
  linkedFeatures?: string[];
  hasVisualChangesets?: boolean;
  hasURLRedirects?: boolean;
};

// Where a flag serves what uses a shared resource: everywhere it's on when a
// flag-wide field uses it, otherwise where a rule using it is enabled.
function environmentsUsing(
  feature: FeatureInterface,
  uses: (feature: FeatureInterface) => boolean,
  allowedEnvs: string[],
): Set<string> {
  return getEnabledEnvironments(
    feature,
    allowedEnvs,
    uses({ ...feature, rules: [] })
      ? undefined
      : (rule) => uses({ ...feature, rules: [rule] }),
  );
}

export function getDependentEntities(
  {
    features,
    experiments = [],
    uses,
  }: {
    features: FeatureInterface[];
    experiments?: DependentExperiment[];
    // Whether a flag, or the part of one given, uses the changed resource.
    uses: (feature: FeatureInterface) => boolean;
  },
  scope: OrgScope,
  featuresById: Map<string, FeatureInterface> = new Map(),
): EventRelatedEntity[] {
  const featureEntities = toEntities(
    "feature",
    new Map(
      features.map((f) => [
        f.id,
        {
          environments: environmentsUsing(f, uses, scope.environments),
          projects: resolveTargetingProjectIds(f, scope.projectIds),
          tags: f.tags ?? [],
        },
      ]),
    ),
    scope.environments,
  );
  const experimentEntities = toEntities(
    "experiment",
    new Map(
      experiments.map((experiment) => [
        experiment.id,
        {
          environments: getExperimentReach(
            experiment.id,
            !!(experiment.hasVisualChangesets || experiment.hasURLRedirects),
            (experiment.linkedFeatures ?? []).flatMap(
              (id) => featuresById.get(id) ?? [],
            ),
            scope,
          ).environments,
          projects: experiment.project ? [experiment.project] : [],
          tags: experiment.tags ?? [],
        },
      ]),
    ),
    scope.environments,
  );
  return [...featureEntities, ...experimentEntities];
}

// What a saved group, constant or config change reaches, for its event.
export type EventReach = {
  environments: string[];
  relatedEntities: EventRelatedEntity[];
};

export const NO_REACH: EventReach = { environments: [], relatedEntities: [] };

// Where its dependents use the changed resource, and where the other payloads
// it alters are served.
export function dependentsReach(
  relatedEntities: EventRelatedEntity[],
  otherPayloadKeys: { environment: string }[],
  allowedEnvs: string[],
): EventReach {
  const envs = new Set([
    ...otherPayloadKeys.map((k) => k.environment),
    ...relatedEntities.flatMap((e) =>
      "environments" in e ? e.environments : [],
    ),
  ]);
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

// What a webhook may be sent of an event's related entities: those in its
// Projects and tags, narrowed to its environments.
export function scopeRelatedEntities(
  entities: EventRelatedEntity[],
  webhook: { projects?: string[]; tags?: string[]; environments?: string[] },
): EventRelatedEntity[] {
  const environments = webhook.environments ?? [];
  const misses = (filter: string[] = [], values?: string[]) =>
    filter.length > 0 && !!values && !values.some((v) => filter.includes(v));
  return entities.flatMap((entity): EventRelatedEntity[] => {
    if (entity.type === "rampSchedule") return [entity];
    if (
      misses(webhook.projects, entity.projects) ||
      misses(webhook.tags, entity.tags)
    ) {
      return [];
    }
    if (!environments.length) return [entity];
    const envs = entity.environments.filter((e) => environments.includes(e));
    return envs.length ? [{ ...entity, environments: envs }] : [];
  });
}
