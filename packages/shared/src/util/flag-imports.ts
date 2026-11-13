import { z } from "zod";
import type { postFeatureBodyV2 } from "../validators/features-v2";
import type { postExperimentValidator } from "../validators/experiments";
import type {
  FlagImportFlag,
  FlagImportSummary,
  FlagImportWarning,
  FlagsJson,
  FlagsJsonFeature,
  FlagsJsonRule,
  flagImportValueTypes,
} from "../validators/flag-imports";

type ValueType = (typeof flagImportValueTypes)[number];
type PostFeatureBodyV2 = z.infer<typeof postFeatureBodyV2>;
type PostExperimentBody = z.infer<
  (typeof postExperimentValidator)["bodySchema"]
>;

// The local flags guide targets environments with this attribute.
const ENV_ATTRIBUTE = "env";
const DEFAULT_HASH_ATTRIBUTE = "id";

export type FlagImportAttribute = {
  property: string;
  datatype: "boolean" | "string" | "number" | "string[]" | "number[]";
  hashAttribute: boolean;
  format?: "version";
};

export type FlagImportExperiment = {
  trackingKey: string;
  name: string;
  hashAttribute: string;
  hashVersion: 1 | 2;
  seed: string;
  coverage: number;
  condition: string;
  weights: number[];
  variations: { key: string; name: string }[];
};

type RuleBase = {
  condition: string;
  // null means every environment
  environments: string[] | null;
};

export type FlagImportRule =
  | (RuleBase & { type: "force"; value: string })
  | (RuleBase & {
      type: "rollout";
      value: string;
      coverage: number;
      hashAttribute: string;
      seed: string;
      hashVersion: 1 | 2;
    })
  | (RuleBase & { type: "experiment"; trackingKey: string; values: string[] });

export type FlagImportPlannedFlag = {
  key: string;
  valueType: ValueType;
  defaultValue: string;
  ruleCount: number;
  rules: FlagImportRule[];
  // Any entry keeps the whole flag out: dropping one rule changes who the rest reach.
  unsupported: string[];
};

export type FlagImportPlan = {
  flags: FlagImportPlannedFlag[];
  experiments: FlagImportExperiment[];
  environments: string[];
  attributes: FlagImportAttribute[];
  warnings: FlagImportWarning[];
  summary: FlagImportSummary;
};

const UNSUPPORTED_RULE_FIELDS: [keyof FlagsJsonRule, string][] = [
  ["parentConditions", "prerequisites"],
  ["namespace", "namespaces"],
  ["filters", "namespaces"],
  ["range", "bucket ranges"],
  ["ranges", "bucket ranges"],
  ["tracks", "tracked experiments"],
  ["contextualBanditRef", "contextual bandits"],
  ["contextualVariations", "contextual bandits"],
  ["fallbackAttribute", "sticky bucketing"],
  ["disableStickyBucketing", "sticky bucketing"],
  ["bucketVersion", "sticky bucketing"],
  ["minBucketVersion", "sticky bucketing"],
];

// Keys here come from the upload, so "constructor" or "toString" must read
// as a missing entry, not as the object's inherited property.
function ownEntry<T>(
  record: Record<string, T> | undefined,
  key: string,
): T | undefined {
  return record && Object.prototype.hasOwnProperty.call(record, key)
    ? record[key]
    : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function valueKind(value: unknown): ValueType {
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number") return "number";
  if (typeof value === "string") return "string";
  return "json";
}

function toStoredValue(value: unknown, valueType: ValueType): string {
  if (valueType === "string") return value as string;
  if (valueType === "json") return JSON.stringify(value);
  return String(value);
}

function mentionsKey(node: unknown, keys: string[]): boolean {
  if (Array.isArray(node)) return node.some((item) => mentionsKey(item, keys));
  if (!isPlainObject(node)) return false;
  return Object.entries(node).some(
    ([key, value]) => keys.includes(key) || mentionsKey(value, keys),
  );
}

function readEnvironments(value: unknown): string[] | null {
  if (typeof value === "string") return [value];
  if (!isPlainObject(value) || Object.keys(value).length !== 1) return null;
  if (typeof value.$eq === "string") return [value.$eq];
  const list = value.$in;
  if (
    Array.isArray(list) &&
    list.length > 0 &&
    list.every((item): item is string => typeof item === "string")
  ) {
    return [...new Set(list)];
  }
  return null;
}

type AttributeGuess = Pick<FlagImportAttribute, "datatype" | "format"> | null;

function scalarGuess(value: unknown): AttributeGuess {
  const kind = valueKind(value);
  return kind === "json" ? null : { datatype: kind };
}

function listGuess(values: unknown): AttributeGuess {
  if (!Array.isArray(values) || !values.length) return null;
  return values.every((v) => typeof v === "number")
    ? { datatype: "number" }
    : { datatype: "string" };
}

function asArray(guess: AttributeGuess): AttributeGuess {
  return { datatype: guess?.datatype === "number" ? "number[]" : "string[]" };
}

function guessAttribute(value: unknown): AttributeGuess {
  if (!isPlainObject(value)) return scalarGuess(value);
  for (const [operator, operand] of Object.entries(value)) {
    let guess: AttributeGuess = null;
    if (operator === "$in" || operator === "$nin") guess = listGuess(operand);
    else if (operator === "$regex") guess = { datatype: "string" };
    else if (operator.startsWith("$v"))
      guess = { datatype: "string", format: "version" };
    else if (operator === "$all") guess = asArray(listGuess(operand));
    else if (operator === "$elemMatch")
      guess = asArray(guessAttribute(operand));
    else if (operator === "$size") guess = { datatype: "string[]" };
    else if (operator === "$not") guess = guessAttribute(operand);
    else if (operator !== "$exists" && operator !== "$type")
      guess = scalarGuess(operand);
    if (guess) return guess;
  }
  return null;
}

function collectAttributes(
  node: unknown,
  found: Map<string, FlagImportAttribute>,
): void {
  if (Array.isArray(node)) {
    node.forEach((item) => collectAttributes(item, found));
    return;
  }
  if (!isPlainObject(node)) return;
  Object.entries(node).forEach(([key, value]) => {
    if (key.startsWith("$")) {
      collectAttributes(value, found);
      return;
    }
    const guess = guessAttribute(value);
    const existing = found.get(key);
    if (!existing) {
      found.set(key, {
        property: key,
        datatype: guess?.datatype ?? "string",
        hashAttribute: false,
        ...(guess?.format && { format: guess.format }),
      });
    }
  });
}

function noteHashAttribute(
  property: string,
  found: Map<string, FlagImportAttribute>,
): void {
  const existing = found.get(property);
  found.set(property, {
    property,
    datatype: existing?.datatype ?? "string",
    ...(existing?.format && { format: existing.format }),
    hashAttribute: true,
  });
}

export type FlagImportRuleFix = { remove: true } | { environments: string[] };

// What a person changes before importing, keyed by Feature Flag key and then
// by the rule's position in the file.
export type FlagImportOverrides = {
  rules?: Record<string, Record<string, FlagImportRuleFix>>;
};

export type FlagImportPreviewRule = {
  // Position in the file, so a fix can name it.
  index: number;
  type: "force" | "rollout" | "experiment";
  condition: string;
  // null means every environment
  environments: string[] | null;
  value: string | null;
  coverage: number | null;
  hashAttribute: string | null;
  experiment: {
    trackingKey: string;
    name: string;
    variations: { name: string; value: string; weight: number }[];
  } | null;
  issue: string | null;
  // Choosing the rule's environments resolves the issue.
  fixable: boolean;
};

export type FlagImportPreviewFlag = {
  key: string;
  valueType: ValueType;
  defaultValue: string;
  rules: FlagImportPreviewRule[];
  importable: boolean;
  reason: string | null;
};

type PlannedRule = {
  rule: FlagImportRule;
  experiment: FlagImportExperiment | null;
};

type RuleFailure = { error: string; fixable: boolean };

function planRule(
  flagKey: string,
  rule: FlagsJsonRule,
  index: number,
  valueType: ValueType,
  environmentsFix?: string[],
): PlannedRule | RuleFailure {
  const label = `Rule ${index + 1}`;
  const fail = (message: string, fixable = false): RuleFailure => ({
    error: `${label} ${message}`,
    fixable,
  });

  const unsupported = UNSUPPORTED_RULE_FIELDS.find(
    ([field]) => rule[field] !== undefined,
  );
  if (unsupported) {
    return fail(
      `uses ${unsupported[1]}, which this import does not support yet`,
    );
  }

  const condition = { ...(rule.condition ?? {}) };
  let environments: string[] | null = null;
  if (environmentsFix) {
    environments = [...environmentsFix];
    delete condition[ENV_ATTRIBUTE];
  } else if (ENV_ATTRIBUTE in condition) {
    environments = readEnvironments(condition[ENV_ATTRIBUTE]);
    if (!environments) {
      return fail(
        `must match ${ENV_ATTRIBUTE} with a plain value, $eq or $in`,
        true,
      );
    }
    delete condition[ENV_ATTRIBUTE];
  }
  if (mentionsKey(condition, [ENV_ATTRIBUTE])) {
    return fail(
      `nests ${ENV_ATTRIBUTE} inside another operator. Put it at the top of the condition`,
    );
  }
  if (mentionsKey(condition, ["$inGroup", "$notInGroup"])) {
    return fail(
      "targets a Saved Group, which this import does not support yet",
    );
  }

  const base: RuleBase = {
    condition: Object.keys(condition).length ? JSON.stringify(condition) : "",
    environments,
  };
  const hasForce = rule.force !== undefined;

  if (rule.variations) {
    if (hasForce) return fail("has both force and variations");
    const count = rule.variations.length;
    if (rule.weights && rule.weights.length !== count) {
      return fail(`has ${rule.weights.length} weights for ${count} variations`);
    }
    if (rule.meta?.some((m) => m.passthrough)) {
      return fail(
        "uses passthrough variations, which this import does not support yet",
      );
    }
    const trackingKey = rule.key ?? flagKey;
    return {
      // The targeting lives on the experiment, as it does for any linked rule.
      rule: {
        ...base,
        condition: "",
        type: "experiment",
        trackingKey,
        values: rule.variations.map((v) => toStoredValue(v, valueType)),
      },
      experiment: {
        trackingKey,
        name: rule.name ?? trackingKey,
        hashAttribute: rule.hashAttribute ?? DEFAULT_HASH_ATTRIBUTE,
        // What the SDK uses when the file leaves these out, so nobody is re-bucketed.
        hashVersion: rule.hashVersion ?? 1,
        seed: rule.seed ?? trackingKey,
        coverage: rule.coverage ?? 1,
        condition: base.condition,
        weights: rule.weights ?? rule.variations.map(() => 1 / count),
        variations: rule.variations.map((_, i) => ({
          key: rule.meta?.[i]?.key ?? String(i),
          name:
            rule.meta?.[i]?.name ?? (i === 0 ? "Control" : `Variation ${i}`),
        })),
      },
    };
  }

  if (!hasForce) return fail("has neither force nor variations");
  const value = toStoredValue(rule.force, valueType);
  if (rule.coverage === undefined || rule.coverage >= 1) {
    return { rule: { ...base, type: "force", value }, experiment: null };
  }
  return {
    rule: {
      ...base,
      type: "rollout",
      value,
      coverage: rule.coverage,
      hashAttribute: rule.hashAttribute ?? DEFAULT_HASH_ATTRIBUTE,
      // The SDK seeds a rollout with the flag key and hash version 1 when the
      // file leaves them out. Pinning both keeps the same users in the rollout.
      seed: rule.seed ?? flagKey,
      hashVersion: rule.hashVersion ?? 1,
    },
    experiment: null,
  };
}

type RuleOutcome = {
  index: number;
  source: FlagsJsonRule;
  planned: PlannedRule | null;
  failure: RuleFailure | null;
};

type PlannedFlagWithExperiments = FlagImportPlannedFlag & {
  experiments: FlagImportExperiment[];
  mixedTypes: boolean;
  outcomes: RuleOutcome[];
};

function planFlag(
  key: string,
  feature: FlagsJsonFeature,
  fixes: Record<string, FlagImportRuleFix> = {},
): PlannedFlagWithExperiments {
  const rules = (feature.rules ?? [])
    .map((source, index) => ({
      source,
      index,
      fix: ownEntry(fixes, String(index)),
    }))
    .filter(({ fix }) => !(fix && "remove" in fix));
  const kinds = new Set(
    [
      feature.defaultValue,
      ...rules.flatMap(({ source }) => [
        ...(source.force !== undefined ? [source.force] : []),
        ...(source.variations ?? []),
      ]),
    ].map(valueKind),
  );
  const valueType: ValueType = kinds.size === 1 ? [...kinds][0] : "json";

  const unsupported: string[] = [];
  const planned: FlagImportRule[] = [];
  const experiments: FlagImportExperiment[] = [];
  const outcomes: RuleOutcome[] = [];
  rules.forEach(({ source, index, fix }) => {
    const result = planRule(
      key,
      source,
      index,
      valueType,
      fix && "environments" in fix ? fix.environments : undefined,
    );
    if ("error" in result) {
      unsupported.push(result.error);
      outcomes.push({ index, source, planned: null, failure: result });
      return;
    }
    planned.push(result.rule);
    const reused =
      result.experiment &&
      experiments.some((e) => e.trackingKey === result.experiment?.trackingKey);
    if (result.experiment && reused) {
      const failure = {
        error: `Rule ${index + 1} reuses the experiment key ${result.experiment.trackingKey} from an earlier rule`,
        fixable: false,
      };
      unsupported.push(failure.error);
      outcomes.push({ index, source, planned: result, failure });
      return;
    }
    outcomes.push({ index, source, planned: result, failure: null });
    if (result.experiment) experiments.push(result.experiment);
  });

  return {
    key,
    valueType,
    defaultValue: toStoredValue(feature.defaultValue, valueType),
    ruleCount: rules.length,
    rules: planned,
    unsupported,
    experiments,
    mixedTypes: kinds.size > 1,
    outcomes,
  };
}

function previewRule(
  valueType: ValueType,
  { index, source, planned, failure }: RuleOutcome,
): FlagImportPreviewRule {
  const issue = { issue: failure?.error ?? null, fixable: !!failure?.fixable };
  if (!planned) {
    // Shown as written, since it could not be read as a GrowthBook rule.
    return {
      index,
      type: source.variations
        ? "experiment"
        : source.coverage !== undefined && source.coverage < 1
          ? "rollout"
          : "force",
      condition:
        source.condition && Object.keys(source.condition).length
          ? JSON.stringify(source.condition)
          : "",
      environments: [],
      value:
        source.force !== undefined
          ? toStoredValue(source.force, valueType)
          : null,
      coverage: source.coverage ?? null,
      hashAttribute: source.hashAttribute ?? null,
      experiment: null,
      ...issue,
    };
  }
  const { rule, experiment } = planned;
  if (rule.type === "experiment") {
    return {
      index,
      type: "experiment",
      condition: experiment?.condition ?? "",
      environments: rule.environments,
      value: null,
      coverage: experiment?.coverage ?? 1,
      hashAttribute: experiment?.hashAttribute ?? DEFAULT_HASH_ATTRIBUTE,
      experiment: {
        trackingKey: rule.trackingKey,
        name: experiment?.name ?? rule.trackingKey,
        variations: rule.values.map((value, i) => ({
          name: experiment?.variations[i]?.name ?? `Variation ${i}`,
          value,
          weight: experiment?.weights[i] ?? 0,
        })),
      },
      ...issue,
    };
  }
  return {
    index,
    type: rule.type,
    condition: rule.condition,
    environments: rule.environments,
    value: rule.value,
    coverage: rule.type === "rollout" ? rule.coverage : null,
    hashAttribute: rule.type === "rollout" ? rule.hashAttribute : null,
    experiment: null,
    ...issue,
  };
}

function planAll(
  file: FlagsJson,
  overrides: FlagImportOverrides,
): { plan: FlagImportPlan; previews: FlagImportPreviewFlag[] } {
  const warnings: FlagImportWarning[] = [];
  const experiments = new Map<string, FlagImportExperiment>();
  const environments = new Set<string>();
  const attributes = new Map<string, FlagImportAttribute>();
  const previews: FlagImportPreviewFlag[] = [];

  const flags = Object.entries(file.features).map(([key, feature]) => {
    const {
      experiments: own,
      mixedTypes,
      outcomes,
      ...flag
    } = planFlag(key, feature, ownEntry(overrides.rules, key));
    const path = `features.${key}`;

    // One experiment can sit behind several flags, but only as one definition.
    const conflict = own.find((exp) => {
      const existing = experiments.get(exp.trackingKey);
      return existing && JSON.stringify(existing) !== JSON.stringify(exp);
    });
    if (conflict) {
      flag.unsupported.push(
        `The experiment key ${conflict.trackingKey} is used elsewhere in the file with different settings`,
      );
    }
    previews.push({
      key,
      valueType: flag.valueType,
      defaultValue: flag.defaultValue,
      rules: outcomes.map((outcome) => previewRule(flag.valueType, outcome)),
      importable: !flag.unsupported.length,
      reason: flag.unsupported.join(". ") || null,
    });
    if (flag.unsupported.length) {
      flag.unsupported.forEach((message) => warnings.push({ path, message }));
      return flag;
    }

    if (mixedTypes) {
      warnings.push({
        path,
        message: "Its values have different types, so it is imported as JSON",
      });
    }
    own.forEach((exp) => {
      experiments.set(exp.trackingKey, exp);
      noteHashAttribute(exp.hashAttribute, attributes);
      if (exp.condition)
        collectAttributes(JSON.parse(exp.condition), attributes);
    });
    flag.rules.forEach((rule) => {
      rule.environments?.forEach((env) => environments.add(env));
      if (rule.condition) {
        collectAttributes(JSON.parse(rule.condition), attributes);
      }
      if (rule.type === "rollout") {
        noteHashAttribute(rule.hashAttribute, attributes);
      }
    });
    return flag;
  });

  (file.experiments ?? []).forEach((_, i) =>
    warnings.push({
      path: `experiments[${i}]`,
      message:
        "Visual editor and URL redirect experiments are not imported yet",
    }),
  );

  return {
    previews,
    plan: {
      flags,
      experiments: [...experiments.values()],
      environments: [...environments],
      attributes: [...attributes.values()],
      warnings,
      summary: {
        flags: flags.length,
        rules: flags.reduce((total, flag) => total + flag.ruleCount, 0),
        experiments: experiments.size + (file.experiments?.length ?? 0),
        environments: [...environments],
        attributes: [...attributes.keys()],
      },
    },
  };
}

export function planFlagImport(
  file: FlagsJson,
  overrides: FlagImportOverrides = {},
): FlagImportPlan {
  return planAll(file, overrides).plan;
}

// Every Feature Flag in the file as the claim page shows it, importable or not.
export function previewFlagImport(
  file: FlagsJson,
  overrides: FlagImportOverrides = {},
): FlagImportPreviewFlag[] {
  return planAll(file, overrides).previews;
}

export function selectFlagImportFlags(
  file: FlagsJson,
  keys?: string[],
): FlagsJson {
  if (!keys) return file;
  const wanted = new Set(keys);
  return {
    ...file,
    features: Object.fromEntries(
      Object.entries(file.features).filter(([key]) => wanted.has(key)),
    ),
  };
}

// Swaps environment names from the file for the workspace's own.
export function mapFlagImportEnvironments(
  plan: FlagImportPlan,
  map: Record<string, string> = {},
): FlagImportPlan {
  const rename = (envs: string[]) => [
    ...new Set(envs.map((env) => ownEntry(map, env) || env)),
  ];
  const environments = rename(plan.environments);
  return {
    ...plan,
    flags: plan.flags.map((flag) => ({
      ...flag,
      rules: flag.rules.map((rule) =>
        rule.environments
          ? { ...rule, environments: rename(rule.environments) }
          : rule,
      ),
    })),
    environments,
    summary: { ...plan.summary, environments },
  };
}

export function getFlagImportFlags(plan: FlagImportPlan): FlagImportFlag[] {
  return plan.flags.map((flag) => ({
    key: flag.key,
    valueType: flag.valueType,
    rules: flag.ruleCount,
    experiments: flag.rules.filter((rule) => rule.type === "experiment").length,
    importable: !flag.unsupported.length,
    reason: flag.unsupported.join(". ") || null,
  }));
}

export function buildFlagImportExperimentBody(
  experiment: FlagImportExperiment,
  options: { project?: string; owner?: string; dateStarted: string },
): PostExperimentBody {
  return {
    trackingKey: experiment.trackingKey,
    name: experiment.name,
    ...(options.project && { project: options.project }),
    ...(options.owner && { owner: options.owner }),
    // The API insists on an assignment query; an empty id means no data source yet.
    assignmentQuery: { id: "" },
    hashAttribute: experiment.hashAttribute,
    hashVersion: experiment.hashVersion,
    variations: experiment.variations,
    phases: [
      {
        name: "Main",
        dateStarted: options.dateStarted,
        coverage: experiment.coverage,
        seed: experiment.seed,
        variationWeights: experiment.weights,
        ...(experiment.condition && {
          targetingCondition: experiment.condition,
        }),
      },
    ],
  };
}

// A rule aimed only at environments the workspace lacks is left out: it never
// applied in the environments that do exist.
export function buildFlagImportFeatureBody(
  flag: FlagImportPlannedFlag,
  options: {
    project?: string;
    owner?: string;
    environmentIds: string[];
    experiments: Record<string, { id: string; variationIds: string[] }>;
  },
): { body: PostFeatureBodyV2; droppedRules: number } {
  const rules: NonNullable<PostFeatureBodyV2["rules"]> = [];
  flag.rules.forEach((rule) => {
    const environments = rule.environments?.filter((env) =>
      options.environmentIds.includes(env),
    );
    if (environments && !environments.length) return;
    const shared = environments
      ? { allEnvironments: false, environments }
      : { allEnvironments: true };

    if (rule.type === "experiment") {
      const experiment = options.experiments[rule.trackingKey];
      if (!experiment) {
        throw new Error(`Missing experiment ${rule.trackingKey}`);
      }
      rules.push({
        ...shared,
        type: "experiment-ref",
        experimentId: experiment.id,
        variations: rule.values.map((value, i) => ({
          value,
          variationId: experiment.variationIds[i],
        })),
      });
      return;
    }

    const targeted = {
      ...shared,
      ...(rule.condition && { condition: rule.condition }),
      value: rule.value,
    };
    if (rule.type === "force") {
      rules.push({ ...targeted, type: "force" });
      return;
    }
    rules.push({
      ...targeted,
      type: "rollout",
      coverage: rule.coverage,
      hashAttribute: rule.hashAttribute,
      seed: rule.seed,
      hashVersion: rule.hashVersion,
    });
  });

  return {
    body: {
      id: flag.key,
      ...(options.project && { project: options.project }),
      ...(options.owner && { owner: options.owner }),
      valueType: flag.valueType,
      defaultValue: flag.defaultValue,
      rules,
      environments: Object.fromEntries(
        options.environmentIds.map((env) => [env, { enabled: true }]),
      ),
    },
    droppedRules: flag.rules.length - rules.length,
  };
}
