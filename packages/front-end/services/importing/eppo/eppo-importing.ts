import { isEqual, pick } from "lodash";
import {
  FeatureInterface,
  FeatureRule,
  FeatureValueType,
} from "shared/types/feature";
import {
  ExperimentInterfaceStringDates,
  ExperimentPhaseStringDates,
} from "shared/types/experiment";
import { SavedGroupInterface } from "shared/types/saved-group";
import {
  ColumnInterface,
  ColumnRef,
  CreateFactMetricProps,
  CreateFactTableProps,
  FactMetricInterface,
  FactTableInterface,
  FunnelStep,
  MetricCappingSettings,
  MetricWindowSettings,
} from "shared/types/fact-table";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { SDKAttribute } from "shared/types/organization";
import {
  ApiAutoRun,
  AutoRunArtifact,
  MAX_AUTO_RUN_ARTIFACTS,
} from "shared/validators";
import {
  DEFAULT_LOSE_RISK_THRESHOLD,
  DEFAULT_MAX_PERCENT_CHANGE,
  DEFAULT_MIN_PERCENT_CHANGE,
  DEFAULT_MIN_SAMPLE_SIZE,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_TARGET_MDE,
  DEFAULT_WIN_RISK_THRESHOLD,
} from "shared/constants";
import { ensureAttributeExists } from "@/services/importing/statsig/transformers/attributeCreator";

// Eppo REST API shapes (https://eppo.cloud/api/docs), limited to the fields we use

export type EppoEnvironment = { id: number; name: string };

export type EppoTag = { id: number; name: string; description?: string };

export type EppoCondition = {
  attribute: string;
  operator:
    | "LT"
    | "LTE"
    | "GT"
    | "GTE"
    | "MATCHES"
    | "ONE_OF"
    | "NOT_ONE_OF"
    | "IS_NULL";
  values: string[];
};

export type EppoTargetingRule = { conditions: EppoCondition[] };

export type EppoAudience = {
  id: number;
  name: string;
  description: string;
  targeting_rules?: EppoTargetingRule[];
};

// Eppo's API has no variation value
export type EppoVariation = {
  id: number;
  name: string;
  variant_key: string;
  value?: unknown;
};

export type EppoAllocation = {
  id: number;
  key: string;
  name: string;
  archived_at?: string;
  type: "FEATURE_GATE" | "EXPERIMENT" | "SWITCHBACK";
  variation_weight: { variation_id: number; weight: number }[];
  targeting_rules: EppoTargetingRule[];
  audiences: { audience_id: number; type: "IS_IN" | "IS_NOT_IN" }[];
  // 0-1
  percent_exposure: number;
  is_default: boolean;
  environment_id?: number;
  // The Eppo experiment analyzing an EXPERIMENT allocation
  experiment?: { id: number; name: string; status: string } | null;
};

export type EppoFlag = {
  id: number;
  key: string;
  name: string;
  description: string;
  variation_type: "BOOLEAN" | "INTEGER" | "JSON" | "NUMERIC" | "STRING";
  environments?: {
    id: number;
    name: string;
    active: boolean;
    is_production: boolean;
  }[];
  variations?: EppoVariation[];
  allocations?: EppoAllocation[];
  tag_names: string[];
  type?: "BANDIT" | "FEATURE_FLAG" | "LAYER";
};

export type EppoEntity = { id: number; name: string };

export type EppoFactSource = {
  id: number;
  name: string;
  sql: string;
  timestamp_column: string;
  entities: { id: number; entity_join_column_name: string }[];
  dimensions: { id: number; name: string; column: string }[];
};

type EppoMetricFilter = {
  metric_event_dimension_id: number;
  operation: "EQUALS" | "DOES_NOT_EQUAL";
  values: string[];
};

// Documented as a string, but Eppo stores "Each Record" facts with a null column
type FactColumn = string | null;

type EppoAggregation = {
  metric_event_source_id: number;
  operation: string;
  column: FactColumn;
  retention_threshold_days?: number | null;
  conversion_threshold_days?: number | null;
  aggregation_timeframe_unit?: string | null;
  aggregation_timeframe_start_value?: number | null;
  aggregation_timeframe_end_value?: number | null;
  // 0.8-0.9999
  winsor_upper_percentile?: number | null;
  winsor_upper_fixed_value?: number | null;
  // 0.0001-0.2
  winsor_lower_percentile?: number | null;
  winsor_lower_fixed_value?: number | null;
  winsor_basis_filter?: "positiveOnly" | string | null;
  filters?: EppoMetricFilter[];
  threshold_metric_settings?: {
    comparison_operator: "gt" | "gte" | "lt" | "lte" | "eq" | "neq" | null;
    aggregation_type: "count" | "sum" | null;
    breach_value: number | null;
    timeframe_value: number | null;
    timeframe_dimension: "days" | "weeks" | "hours" | "minutes" | null;
  } | null;
};

export type EppoMetric = {
  id: number;
  name: string;
  description: string;
  numerator_aggregation?: EppoAggregation | null;
  denominator_aggregation?: EppoAggregation | null;
  percentile?: {
    metric_event_source_id: number;
    column: FactColumn;
    // 0.01-0.99
    percentile_value: number;
    filters?: EppoMetricFilter[];
  } | null;
  funnel_aggregation?: {
    funnel_steps: {
      metric_event_source_id: number;
      measure_name: string;
    }[];
    conversion_time_from: "experimentAssignment" | "firstEvent" | null;
    conversion_time_seconds: number | null;
    order: string;
  } | null;
  desired_change: "increase" | "decrease";
  minimum_detectable_effect?: number | null;
  display_style?: "decimal" | "percent";
};

export type EppoExperiment = {
  id: number;
  name: string;
  status: "DRAFT" | "RUNNING" | "READY" | "WRAP_UP" | "COMPLETED";
  computation_type?:
    | "STANDARD"
    | "CLUSTERED_ANALYSIS"
    | "SECONDARY_ID"
    | "SWITCHBACK";
  is_holdout_analysis?: boolean;
  experiment_key?: string;
  hypothesis?: string;
  assignments_start_date?: string;
  assignments_end_date?: string;
  // 0-1
  traffic_allocation?: number;
  winning_variant_key?: string;
  outcome?:
    | "POSITIVE"
    | "NEGATIVE"
    | "NEUTRAL"
    | "INCONCLUSIVE"
    | "MISCONFIGURED";
  key_takeaways?: string;
  metrics?: {
    metric_id: number;
    is_primary: boolean;
    is_guardrail?: boolean;
  }[];
  variations: {
    name: string;
    variant_key: string;
    is_control: boolean;
    weighted_expected_traffic: number;
    is_active: boolean;
    variation_id: number;
  }[];
  analysis_plan?: {
    confidence_interval_method?: string;
    compute_cuped?: boolean;
  };
  tag_names?: string[];
};

export type EppoData = {
  environments: EppoEnvironment[];
  tags: EppoTag[];
  audiences: EppoAudience[];
  flags: EppoFlag[];
  entities: EppoEntity[];
  factSources: EppoFactSource[];
  metrics: EppoMetric[];
  experiments: EppoExperiment[];
};

type ApiCall = <T>(url: string, options?: RequestInit) => Promise<T>;

// Eppo doesn't send CORS headers, so every request goes through our back-end
async function getFromEppo<T>(
  endpoint: string,
  apiKey: string,
  apiCall: ApiCall,
): Promise<T[]> {
  let res: unknown;
  try {
    res = await apiCall<unknown>("/importing/eppo", {
      method: "POST",
      body: JSON.stringify({ endpoint, apiKey }),
    });
  } catch (e) {
    throw new Error(`Eppo /${endpoint}: ${e.message}`);
  }
  if (!Array.isArray(res)) {
    throw new Error(`Unexpected response from Eppo /${endpoint}`);
  }
  return res;
}

async function getAllPages<T>(
  endpoint: string,
  pageSize: number,
  apiKey: string,
  apiCall: ApiCall,
): Promise<T[]> {
  const all: T[] = [];
  const separator = endpoint.includes("?") ? "&" : "?";
  // Page cap guards against an API that ignores offset
  for (let page = 0; page < 200; page++) {
    const items = await getFromEppo<T>(
      `${endpoint}${separator}limit=${pageSize}&offset=${page * pageSize}`,
      apiKey,
      apiCall,
    );
    all.push(...items);
    if (items.length < pageSize) break;
  }
  return all;
}

export async function fetchEppoData(
  apiKey: string,
  apiCall: ApiCall,
): Promise<EppoData> {
  const get = <T>(endpoint: string) =>
    getFromEppo<T>(endpoint, apiKey, apiCall);
  const [
    environments,
    tags,
    audiences,
    flags,
    entities,
    factSources,
    metrics,
    experiments,
  ] = await Promise.all([
    get<EppoEnvironment>("environments"),
    get<EppoTag>("tags"),
    get<EppoAudience>("audiences?status=active"),
    get<EppoFlag>("feature-flags?include_detailed_allocations=true"),
    get<EppoEntity>("definitions/entities"),
    get<EppoFactSource>("definitions/facts"),
    // Metrics document a page size of 50; experiments allow up to 250
    getAllPages<EppoMetric>("metrics", 50, apiKey, apiCall),
    getAllPages<EppoExperiment>("experiments", 250, apiKey, apiCall),
  ]);
  return {
    environments,
    tags,
    audiences,
    flags,
    entities,
    factSources,
    metrics,
    experiments,
  };
}

export type PhaseTargeting = {
  condition: string;
  savedGroups: NonNullable<FeatureRule["savedGroups"]>;
  coverage: number;
};

export type GBExperimentRef = {
  id: string;
  status?: ExperimentInterfaceStringDates["status"];
  variations: { id: string; key: string }[];
  // An experiment-ref rule serves the phase's targeting and weights, not its own
  phase?: PhaseTargeting & { variationWeights?: number[] };
};

// Whether an experiment-ref rule would serve exactly what the allocation does
export function servesLikeAllocation(
  linked: GBExperimentRef,
  served: { key: string; weight: number }[],
  targeting: PhaseTargeting,
): boolean {
  const phase = linked.phase;
  if (linked.status !== "running" || !phase) return false;
  if (!sameTargeting(phase, targeting)) return false;
  if (linked.variations.length !== served.length) return false;
  const total = served.reduce((sum, s) => sum + s.weight, 0);
  const weights = new Map(served.map((s) => [s.key, s.weight / total]));
  return linked.variations.every((v, i) => {
    const w = weights.get(v.key);
    return (
      w !== undefined && Math.abs(w - (phase.variationWeights?.[i] ?? 0)) < 1e-6
    );
  });
}

export type TransformContext = {
  eppo: EppoData;
  project: string;
  datasource: DataSourceInterfaceWithParams | null;
  // Env ids rules may reference: existing plus the ones being created
  environmentIds: Set<string>;
  // Eppo id -> GrowthBook id
  savedGroupIds: Map<number, string>;
  factTableIds: Map<number, string>;
  metricIds: Map<number, string>;
  experiments: Map<number, GBExperimentRef>;
  // GrowthBook Fact Table id -> its columns, once the Fact Table exists
  factTableColumns: Map<string, string[]>;
};

// "Production" -> "production" so it lines up with GrowthBook's defaults
export function toEnvironmentId(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

type Condition = Record<string, unknown>;

// Eppo compares as strings; the SDK compares strictly, so list both forms
export function widenValues(values: string[]): (string | number | boolean)[] {
  const out = new Set<string | number | boolean>();
  for (const v of values) {
    out.add(v);
    const t = v.trim();
    if (t !== "" && String(Number(t)) === t) out.add(Number(t));
    if (t === "true") out.add(true);
    if (t === "false") out.add(false);
  }
  return [...out];
}

// Eppo never matches a missing attribute; the SDK can
function conditionToGB({ attribute, operator, values }: EppoCondition) {
  switch (operator) {
    case "ONE_OF":
      return { [attribute]: { $in: widenValues(values) } };
    case "NOT_ONE_OF":
      return { [attribute]: { $exists: true, $nin: widenValues(values) } };
    case "MATCHES":
      return { [attribute]: { $exists: true, $regex: values.join("|") } };
    case "IS_NULL":
      return {
        [attribute]: { $exists: String(values[0]).toLowerCase() === "false" },
      };
    case "LT":
    case "LTE":
    case "GT":
    case "GTE": {
      // Eppo compares numerically when it can, otherwise as semantic versions
      const value = values[0] ?? "";
      const op = operator.toLowerCase();
      return value.trim() !== "" && !isNaN(Number(value))
        ? { [attribute]: { $exists: true, [`$${op}`]: Number(value) } }
        : { [attribute]: { $exists: true, [`$v${op}`]: value } };
    }
    default:
      throw new Error(`Unsupported targeting operator: ${operator}`);
  }
}

function ruleToCondition(rule: EppoTargetingRule): Condition {
  const conds: Condition[] = (rule.conditions ?? []).map(conditionToGB);
  const merged = Object.assign({}, ...conds);
  // One object reads better, but only works when no attribute repeats
  return Object.keys(merged).length === conds.length ? merged : { $and: conds };
}

// Eppo targeting rules are OR'd together; conditions within a rule are AND'd
export function rulesToCondition(rules: EppoTargetingRule[]): Condition | null {
  const ors = rules.map(ruleToCondition);
  if (!ors.length) return null;
  return ors.length === 1 ? ors[0] : { $or: ors };
}

export function getTargetingAttributes(rules: EppoTargetingRule[]): string[] {
  return rules.flatMap((r) => (r.conditions ?? []).map((c) => c.attribute));
}

// The Saved Group endpoints reject longer descriptions
const SAVED_GROUP_DESCRIPTION_LENGTH = 100;

export function transformAudience(audience: EppoAudience, project: string) {
  const condition = rulesToCondition(audience.targeting_rules ?? []);
  if (!condition) throw new Error("Audience has no targeting rules");
  return {
    groupName: audience.name,
    type: "condition" as const,
    condition: JSON.stringify(condition),
    description: (audience.description || "").slice(
      0,
      SAVED_GROUP_DESCRIPTION_LENGTH,
    ),
    projects: project ? [project] : [],
  };
}

const VALUE_TYPES: Record<EppoFlag["variation_type"], FeatureValueType> = {
  BOOLEAN: "boolean",
  STRING: "string",
  INTEGER: "number",
  NUMERIC: "number",
  JSON: "json",
};

const EMPTY_VALUES: Record<FeatureValueType, string> = {
  boolean: "false",
  string: "",
  number: "0",
  json: "{}",
};

// Eppo's REST API documents variant keys but not variation values, so fall
// back to the key when no value is sent (they match for most string flags).
// A key that isn't a value of the type is an error, not a guess
export function getVariationValue(
  type: FeatureValueType,
  variation: EppoVariation,
): string {
  const raw = variation.value ?? variation.variant_key;
  const str = typeof raw === "string" ? raw.trim() : String(raw);
  if (type === "boolean") {
    if (raw === true || /^(true|on|yes|1)$/i.test(str)) return "true";
    if (raw === false || /^(false|off|no|0)$/i.test(str)) return "false";
    throw new Error(`Variation "${variation.variant_key}" isn't true or false`);
  }
  if (type === "number") {
    if (str === "" || isNaN(Number(str))) {
      throw new Error(`Variation "${variation.variant_key}" isn't a number`);
    }
    return String(Number(str));
  }
  if (type === "json") {
    if (typeof raw !== "string") return JSON.stringify(raw);
    try {
      JSON.parse(raw);
      return raw;
    } catch {
      throw new Error(`Variation "${variation.variant_key}" isn't JSON`);
    }
  }
  return String(raw);
}

// Allocation targeting matches when ANY rule or audience matches
function getAllocationTargeting(
  allocation: EppoAllocation,
  ctx: TransformContext,
): Omit<PhaseTargeting, "coverage"> {
  const rules = allocation.targeting_rules ?? [];
  const audiences = allocation.audiences ?? [];

  // Reference imported Saved Groups when that preserves the OR semantics
  const groupIds = audiences.map((a) =>
    a.type === "IS_IN" ? ctx.savedGroupIds.get(a.audience_id) : undefined,
  );
  if (!rules.length && audiences.length && groupIds.every(Boolean)) {
    return {
      condition: "",
      savedGroups: [{ match: "any", ids: groupIds as string[] }],
    };
  }

  // Otherwise inline each audience's targeting
  const ors = rules.map(ruleToCondition);
  audiences.forEach(({ audience_id, type }) => {
    const audience = ctx.eppo.audiences.find((a) => a.id === audience_id);
    const cond = audience && rulesToCondition(audience.targeting_rules ?? []);
    if (!cond) throw new Error(`Unknown or empty audience ${audience_id}`);
    ors.push(type === "IS_NOT_IN" ? { $not: cond } : cond);
  });
  if (!ors.length) return { condition: "", savedGroups: [] };
  return {
    condition: JSON.stringify(ors.length === 1 ? ors[0] : { $or: ors }),
    savedGroups: [],
  };
}

const allocationCoverage = (a: EppoAllocation) =>
  Math.min(1, Math.max(0, a.percent_exposure ?? 1));

// Targeting shared by the allocations an experiment analyzes, for its phase
export function getLinkedTargeting(
  experimentId: number,
  ctx: TransformContext,
): PhaseTargeting | null {
  const linked = ctx.eppo.flags.flatMap((f) =>
    (f.allocations ?? []).filter(
      (a) => !a.archived_at && a.experiment?.id === experimentId,
    ),
  );
  if (!linked.length) return null;
  try {
    const all = linked.map((a) => ({
      ...getAllocationTargeting(a, ctx),
      coverage: allocationCoverage(a),
    }));
    return all.every((t) => sameTargeting(t, all[0])) ? all[0] : null;
  } catch {
    return null;
  }
}

const parseCondition = (condition: string) =>
  condition ? (JSON.parse(condition) as unknown) : {};

export function sameTargeting(a: PhaseTargeting, b: PhaseTargeting) {
  return (
    a.coverage === b.coverage &&
    isEqual(a.savedGroups ?? [], b.savedGroups ?? []) &&
    isEqual(parseCondition(a.condition), parseCondition(b.condition))
  );
}

export function getFlagAttributes(flag: EppoFlag, eppo: EppoData): string[] {
  return (flag.allocations ?? []).flatMap((a) => [
    ...getTargetingAttributes(a.targeting_rules ?? []),
    ...(a.audiences ?? []).flatMap(({ audience_id }) =>
      getTargetingAttributes(
        eppo.audiences.find((x) => x.id === audience_id)?.targeting_rules ?? [],
      ),
    ),
  ]);
}

// Owner is set by the server
export type FeaturePayload = Omit<
  FeatureInterface,
  "organization" | "dateCreated" | "dateUpdated" | "version" | "owner"
>;

export function transformFlag(
  flag: EppoFlag,
  ctx: TransformContext,
): FeaturePayload {
  if (flag.type && flag.type !== "FEATURE_FLAG") {
    throw new Error(`${flag.type} flags aren't supported`);
  }
  const valueType = VALUE_TYPES[flag.variation_type];
  if (!valueType) {
    throw new Error(`Unknown variation type: ${flag.variation_type}`);
  }
  const variations = new Map(
    (flag.variations ?? []).map((v) => [
      v.id,
      {
        name: v.name,
        key: v.variant_key,
        value: getVariationValue(valueType, v),
      },
    ]),
  );
  if (
    new Set([...variations.values()].map((v) => v.value)).size < variations.size
  ) {
    throw new Error("Two variations would serve the same value");
  }
  const getVariation = (id: number) => {
    const v = variations.get(id);
    if (!v) throw new Error(`Unknown variation ${id}`);
    return v;
  };

  const flagEnvs = (flag.environments ?? []).filter((e) =>
    ctx.environmentIds.has(toEnvironmentId(e.name)),
  );
  const allocations = (flag.allocations ?? []).filter((a) => !a.archived_at);
  const servedVariations = (a: EppoAllocation) =>
    (a.variation_weight ?? []).filter((w) => w.weight > 0);

  // Eppo has no flag-level default; use what production serves to everyone else
  const prodEnvId = (flagEnvs.find((e) => e.is_production) ?? flagEnvs[0])?.id;
  const defaultAllocation =
    allocations.find((a) => a.is_default && a.environment_id === prodEnvId) ??
    allocations.find((a) => a.is_default);
  const defaultServed =
    defaultAllocation && servedVariations(defaultAllocation);
  const defaultValue =
    defaultServed?.length === 1
      ? getVariation(defaultServed[0].variation_id).value
      : EMPTY_VALUES[valueType];

  const environmentSettings: FeaturePayload["environmentSettings"] = {};
  flagEnvs.forEach((env) => {
    environmentSettings[toEnvironmentId(env.name)] = { enabled: env.active };
  });

  const rules: FeatureRule[] = [];
  allocations.forEach((a) => {
    if (a.type === "SWITCHBACK") {
      throw new Error("Switchback allocations aren't supported");
    }
    const served = servedVariations(a);
    if (!served.length) return;
    // The default behind defaultValue is redundant; other defaults stay rules
    if (a === defaultAllocation && defaultServed?.length === 1) return;
    const coverage = allocationCoverage(a);
    if (
      a.is_default &&
      coverage === 1 &&
      served.length === 1 &&
      getVariation(served[0].variation_id).value === defaultValue
    ) {
      return;
    }

    const targeting = getAllocationTargeting(a, ctx);

    // Allocations without an environment apply to all of them
    const environments = flagEnvs
      .filter((e) => !a.environment_id || e.id === a.environment_id)
      .map((e) => toEnvironmentId(e.name));
    if (!environments.length) return;

    const base = {
      id: `fr_eppo_${a.id}`,
      description: a.name,
      enabled: true,
      allEnvironments: false,
      environments,
      ...targeting,
    };

    if (served.length > 1) {
      const linked = a.experiment && ctx.experiments.get(a.experiment.id);
      const byKey = new Map([...variations.values()].map((v) => [v.key, v]));
      if (
        linked &&
        servesLikeAllocation(
          linked,
          served.map((w) => ({
            key: getVariation(w.variation_id).key,
            weight: w.weight,
          })),
          { ...targeting, coverage },
        )
      ) {
        rules.push({
          ...base,
          type: "experiment-ref",
          experimentId: linked.id,
          variations: linked.variations.map((v) => ({
            variationId: v.id,
            value: byKey.get(v.key)?.value ?? "",
          })),
        });
        return;
      }
      const total = served.reduce((sum, w) => sum + w.weight, 0);
      rules.push({
        ...base,
        type: "experiment",
        // Matches the experiment key Eppo SDKs log for assignments
        trackingKey: `${flag.key}-${a.key}`,
        hashAttribute: "id",
        coverage,
        values: served.map((w) => ({
          value: getVariation(w.variation_id).value,
          weight: w.weight / total,
          name: getVariation(w.variation_id).name,
        })),
      });
      return;
    }

    const value = getVariation(served[0].variation_id).value;
    rules.push(
      coverage < 1
        ? { ...base, type: "rollout", value, coverage, hashAttribute: "id" }
        : { ...base, type: "force", value },
    );
  });

  return {
    id: flag.key,
    description: flag.description || (flag.name !== flag.key ? flag.name : ""),
    project: ctx.project,
    tags: flag.tag_names ?? [],
    valueType,
    defaultValue,
    environmentSettings,
    rules,
  };
}

// Description, tags and project stay as the team left them
export function toFlagUpdate(flag: FeaturePayload) {
  return pick(flag, [
    "id",
    "valueType",
    "defaultValue",
    "environmentSettings",
    "rules",
  ]);
}

function requireDatasource(ctx: TransformContext) {
  if (!ctx.datasource) throw new Error("Select a Data Source to import this");
  return ctx.datasource;
}

const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Eppo entities ("User") map to the identifier type with a matching name ("user_id")
function getIdentifierType(
  entityName: string,
  datasource: DataSourceInterfaceWithParams,
): string {
  const idType = (datasource.settings?.userIdTypes ?? []).find(
    ({ userIdType }) =>
      [normalize(entityName), normalize(entityName) + "id"].includes(
        normalize(userIdType),
      ),
  );
  if (!idType) {
    throw new Error(
      `No identifier type on the Data Source matches the Eppo entity "${entityName}"`,
    );
  }
  return idType.userIdType;
}

export type FactTablePayload = Omit<CreateFactTableProps, "owner">;

export function transformFactSource(
  factSource: EppoFactSource,
  ctx: TransformContext,
): FactTablePayload {
  const datasource = requireDatasource(ctx);
  const userIdColumns: Record<string, string> = {};
  factSource.entities.forEach(({ id, entity_join_column_name }) => {
    const entity = ctx.eppo.entities.find((e) => e.id === id);
    const idType = getIdentifierType(entity?.name ?? String(id), datasource);
    userIdColumns[idType] = entity_join_column_name;
  });

  return {
    name: factSource.name,
    description: "",
    datasource: datasource.id,
    projects: ctx.project ? [ctx.project] : [],
    tags: [],
    sql: factSource.sql,
    eventName: "",
    columns: [],
    userIdTypes: Object.keys(userIdColumns),
    userIdColumns,
    timestampColumn: factSource.timestamp_column,
  };
}

export function toFactTableUpdate(factTable: FactTablePayload) {
  return pick(factTable, [
    "name",
    "sql",
    "eventName",
    "userIdTypes",
    "userIdColumns",
    "timestampColumn",
  ]);
}

function toColumnRef(
  factSourceId: number,
  column: string,
  filters: EppoMetricFilter[] | undefined,
  ctx: TransformContext,
): ColumnRef {
  const factTableId = ctx.factTableIds.get(factSourceId);
  if (!factTableId) {
    const name = ctx.eppo.factSources.find((f) => f.id === factSourceId)?.name;
    throw new Error(`Import the "${name ?? factSourceId}" fact source first`);
  }
  const dimensions = ctx.eppo.factSources.flatMap((f) => f.dimensions ?? []);
  return {
    factTableId,
    column,
    aggregation: "sum",
    rowFilters: (filters ?? []).map((f) => {
      const dimension = dimensions.find(
        (d) => d.id === f.metric_event_dimension_id,
      );
      if (!dimension) {
        throw new Error(`Unknown dimension ${f.metric_event_dimension_id}`);
      }
      return {
        column: dimension.column,
        operator: f.operation === "EQUALS" ? "in" : "not_in",
        values: f.values,
      };
    }),
  };
}

// Returns the Fact Table's spelling; the metric endpoints match exactly
function requireColumn(
  factSourceId: number,
  column: FactColumn,
  ctx: TransformContext,
): string {
  if (!column) {
    throw new Error("This metric needs a value column, but its fact has none");
  }
  const columns = ctx.factTableColumns.get(
    ctx.factTableIds.get(factSourceId) ?? "",
  );
  // No columns means detection hasn't run
  if (!columns?.length) return column;
  const match =
    columns.find((c) => c === column) ??
    columns.find((c) => c.toLowerCase() === column.toLowerCase());
  if (!match) {
    const name = ctx.eppo.factSources.find((f) => f.id === factSourceId)?.name;
    throw new Error(`Column "${column}" isn't in the "${name}" Fact Table`);
  }
  return match;
}

const THRESHOLD_OPERATORS = {
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  eq: "=",
  neq: "!=",
};

// Eppo drops NULL fact rows; count aggregations here don't
function aggregationToColumnRef(
  agg: EppoAggregation,
  ctx: TransformContext,
): ColumnRef {
  const ref = (column: string) =>
    toColumnRef(agg.metric_event_source_id, column, agg.filters, ctx);
  const valueColumn = () =>
    requireColumn(agg.metric_event_source_id, agg.column, ctx);
  switch (agg.operation) {
    case "sum":
      return ref(valueColumn());
    case "countDistinct":
      return { ...ref(valueColumn()), aggregation: "count distinct" };
    case "count":
      return ref("$$count");
    case "conversion":
    case "retention":
      return ref("$$distinctUsers");
    case "threshold": {
      const t = agg.threshold_metric_settings;
      const op = t?.comparison_operator
        ? THRESHOLD_OPERATORS[t.comparison_operator]
        : undefined;
      // GrowthBook's aggregate filter only takes non-negative numbers
      if (!t || !op || t.breach_value === null || t.breach_value < 0) {
        throw new Error("Unsupported threshold settings");
      }
      return {
        ...ref("$$distinctUsers"),
        aggregateFilterColumn:
          t.aggregation_type === "sum" ? valueColumn() : "$$count",
        aggregateFilter: `${op} ${t.breach_value}`,
      };
    }
    default:
      throw new Error(`Unsupported metric aggregation: ${agg.operation}`);
  }
}

const WINDOW_UNITS = ["minutes", "hours", "days", "weeks"] as const;

const NO_WINDOW: MetricWindowSettings = {
  type: "",
  delayValue: 0,
  delayUnit: "days",
  windowValue: 0,
  windowUnit: "days",
};

function conversionWindow(
  value: number,
  unit: MetricWindowSettings["windowUnit"],
): MetricWindowSettings {
  return {
    ...NO_WINDOW,
    type: "conversion",
    windowValue: value,
    windowUnit: unit,
  };
}

function getWindowSettings(agg: EppoAggregation): MetricWindowSettings {
  if (agg.operation === "retention") {
    return { ...NO_WINDOW, delayValue: agg.retention_threshold_days ?? 0 };
  }
  if (agg.operation === "conversion" && agg.conversion_threshold_days) {
    return conversionWindow(agg.conversion_threshold_days, "days");
  }
  const t = agg.threshold_metric_settings;
  if (agg.operation === "threshold" && t?.timeframe_value) {
    return conversionWindow(t.timeframe_value, t.timeframe_dimension ?? "days");
  }
  const end = agg.aggregation_timeframe_end_value;
  if (!agg.aggregation_timeframe_unit || !end) return NO_WINDOW;

  const unit =
    agg.aggregation_timeframe_unit === "calendar_days"
      ? "days"
      : WINDOW_UNITS.find((u) => u === agg.aggregation_timeframe_unit);
  if (!unit) {
    throw new Error(
      `Unsupported metric timeframe unit: ${agg.aggregation_timeframe_unit}`,
    );
  }
  const start = agg.aggregation_timeframe_start_value ?? 0;
  return {
    type: "conversion",
    delayValue: start,
    delayUnit: unit,
    windowValue: end - start,
    windowUnit: unit,
  };
}

function secondsToWindow(seconds: number) {
  if (seconds % 86400 === 0)
    return { value: seconds / 86400, unit: "days" as const };
  if (seconds % 3600 === 0)
    return { value: seconds / 3600, unit: "hours" as const };
  return { value: Math.ceil(seconds / 60), unit: "minutes" as const };
}

const NO_CAP: MetricCappingSettings = { type: "", value: 0 };

// positiveOnly is approximated by ignoring zeros
export function getCappingSettings(agg: EppoAggregation): {
  cappingSettings: MetricCappingSettings;
  lowerCappingSettings: MetricCappingSettings;
} {
  const ignoreZeros = agg.winsor_basis_filter === "positiveOnly";
  const tail = (
    fixed: number | null | undefined,
    percentile: number | null | undefined,
  ): MetricCappingSettings => {
    if (typeof fixed === "number") return { type: "absolute", value: fixed };
    if (percentile)
      return { type: "percentile", value: percentile, ignoreZeros };
    return NO_CAP;
  };
  return {
    cappingSettings: tail(
      agg.winsor_upper_fixed_value,
      agg.winsor_upper_percentile,
    ),
    lowerCappingSettings: tail(
      agg.winsor_lower_fixed_value,
      agg.winsor_lower_percentile,
    ),
  };
}

type MetricDefinition = Pick<
  CreateFactMetricProps,
  | "metricType"
  | "numerator"
  | "denominator"
  | "quantileSettings"
  | "funnelSettings"
  | "cappingSettings"
  | "lowerCappingSettings"
  | "windowSettings"
>;

function getMetricDefinition(
  metric: EppoMetric,
  ctx: TransformContext,
): MetricDefinition {
  const base = {
    numerator: null,
    denominator: null,
    quantileSettings: null,
    funnelSettings: null,
    cappingSettings: NO_CAP,
    lowerCappingSettings: NO_CAP,
    windowSettings: NO_WINDOW,
  };

  const funnel = metric.funnel_aggregation;
  if (funnel) {
    if (funnel.order && funnel.order !== "thisOrder") {
      throw new Error(`Unsupported funnel order: ${funnel.order}`);
    }
    const steps: FunnelStep[] = funnel.funnel_steps.map((step, i) => ({
      name: step.measure_name || `Step ${i + 1}`,
      factTableId: toColumnRef(step.metric_event_source_id, "", [], ctx)
        .factTableId,
      rowFilters: [],
      optional: false,
    }));
    let windowSettings = NO_WINDOW;
    if (funnel.conversion_time_seconds) {
      const { value, unit } = secondsToWindow(funnel.conversion_time_seconds);
      if (funnel.conversion_time_from !== "firstEvent") {
        windowSettings = conversionWindow(value, unit);
      } else if (steps.length === 2) {
        // Step windows count from the previous step, which only matches
        // "from the first event" when there are two steps
        steps[1].conversionWindow = { value, unit };
      } else {
        throw new Error(
          "Funnels timed from the first event need exactly 2 steps",
        );
      }
    }
    return {
      ...base,
      metricType: "funnel",
      funnelSettings: { steps, ordering: "sequential" },
      windowSettings,
    };
  }

  if (metric.percentile) {
    const { metric_event_source_id, column, filters, percentile_value } =
      metric.percentile;
    return {
      ...base,
      metricType: "quantile",
      numerator: toColumnRef(
        metric_event_source_id,
        requireColumn(metric_event_source_id, column, ctx),
        filters,
        ctx,
      ),
      quantileSettings: {
        type: "event",
        quantile: percentile_value,
        ignoreZeros: false,
      },
    };
  }

  const num = metric.numerator_aggregation;
  if (!num) throw new Error("Metric has no aggregation");
  const numerator = aggregationToColumnRef(num, ctx);
  const windowSettings = getWindowSettings(num);

  if (metric.denominator_aggregation) {
    return {
      ...base,
      metricType: "ratio",
      numerator,
      denominator: aggregationToColumnRef(metric.denominator_aggregation, ctx),
      ...getCappingSettings(num),
      windowSettings,
    };
  }
  if (num.operation === "conversion" || num.operation === "threshold") {
    return { ...base, metricType: "proportion", numerator, windowSettings };
  }
  if (num.operation === "retention") {
    return { ...base, metricType: "retention", numerator, windowSettings };
  }
  return {
    ...base,
    metricType: "mean",
    numerator,
    ...getCappingSettings(num),
    windowSettings,
  };
}

export type FactMetricPayload = Omit<CreateFactMetricProps, "owner">;

export function transformMetric(
  metric: EppoMetric,
  ctx: TransformContext,
): FactMetricPayload {
  const datasource = requireDatasource(ctx);
  return {
    name: metric.name,
    description: metric.description || "",
    datasource: datasource.id,
    projects: ctx.project ? [ctx.project] : [],
    tags: [],
    archived: false,
    ...getMetricDefinition(metric, ctx),
    priorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: DEFAULT_PROPER_PRIOR_STDDEV,
    },
    inverse: metric.desired_change === "decrease",
    loseRisk: DEFAULT_LOSE_RISK_THRESHOLD,
    winRisk: DEFAULT_WIN_RISK_THRESHOLD,
    maxPercentChange: DEFAULT_MAX_PERCENT_CHANGE,
    minPercentChange: DEFAULT_MIN_PERCENT_CHANGE,
    minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
    targetMDE: metric.minimum_detectable_effect || DEFAULT_TARGET_MDE,
    displayAsPercentage: metric.display_style === "percent",
    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 0,
  };
}

// Only the definition; thresholds, priors, tags and projects stay
export function toMetricUpdate(metric: FactMetricPayload) {
  return {
    ...pick(metric, [
      "name",
      "metricType",
      "numerator",
      "denominator",
      "quantileSettings",
      "funnelSettings",
      "cappingSettings",
      "lowerCappingSettings",
      "windowSettings",
      "inverse",
      "displayAsPercentage",
    ]),
    ...(metric.description ? { description: metric.description } : {}),
  };
}

const RESULTS: Record<
  NonNullable<EppoExperiment["outcome"]>,
  ExperimentInterfaceStringDates["results"]
> = {
  POSITIVE: "won",
  NEGATIVE: "lost",
  NEUTRAL: "inconclusive",
  INCONCLUSIVE: "inconclusive",
  MISCONFIGURED: "dnf",
};

export function transformExperiment(
  experiment: EppoExperiment,
  ctx: TransformContext,
  // Keeps the ids of an experiment being updated
  existing?: GBExperimentRef,
): Partial<ExperimentInterfaceStringDates> {
  if (
    experiment.computation_type &&
    experiment.computation_type !== "STANDARD"
  ) {
    throw new Error(
      `${experiment.computation_type} experiments aren't supported`,
    );
  }
  if (experiment.is_holdout_analysis) {
    throw new Error("Holdout analyses aren't supported");
  }
  // GrowthBook treats the first variation as the control
  const variations = experiment.variations
    .filter((v) => v.is_active)
    .sort((a, b) => Number(b.is_control) - Number(a.is_control));
  if (variations.length < 2) {
    throw new Error("Experiment needs at least 2 active variations");
  }
  const totalTraffic = variations.reduce(
    (sum, v) => sum + (v.weighted_expected_traffic || 0),
    0,
  );
  const variationWeights = variations.map((v) =>
    totalTraffic
      ? (v.weighted_expected_traffic || 0) / totalTraffic
      : 1 / variations.length,
  );
  const existingIds = new Map(
    (existing?.variations ?? []).map((v) => [v.key, v.id]),
  );
  const variationId = (v: EppoExperiment["variations"][number]) =>
    existingIds.get(v.variant_key) ?? `var_eppo_${v.variation_id}`;

  const status =
    experiment.status === "DRAFT"
      ? "draft"
      : experiment.status === "RUNNING"
        ? "running"
        : "stopped";

  // Metrics that weren't imported are left off
  const metrics = (experiment.metrics ?? []).flatMap((m) => {
    const id = ctx.metricIds.get(m.metric_id);
    return id ? [{ ...m, id }] : [];
  });
  const winner = variations.findIndex(
    (v) => v.variant_key === experiment.winning_variant_key,
  );
  const plan = experiment.analysis_plan;
  const method = plan?.confidence_interval_method;

  return {
    name: experiment.name,
    hypothesis: experiment.hypothesis ?? "",
    trackingKey: experiment.experiment_key || `eppo_${experiment.id}`,
    status,
    project: ctx.project,
    hashAttribute: "id",
    hashVersion: 2,
    tags: experiment.tag_names ?? [],
    variations: variations.map((v) => ({
      id: variationId(v),
      key: v.variant_key,
      name: v.name,
      description: "",
      screenshots: [],
    })),
    phases: [
      {
        name: "Main",
        dateStarted: experiment.assignments_start_date ?? "",
        dateEnded:
          status === "stopped" ? (experiment.assignments_end_date ?? "") : "",
        reason: "",
        ...(getLinkedTargeting(experiment.id, ctx) ?? {
          coverage: experiment.traffic_allocation ?? 1,
          condition: "",
          savedGroups: [],
        }),
        prerequisites: [],
        variationWeights,
        variations: variations.map((v) => ({
          id: variationId(v),
          status: "active" as const,
        })),
      },
    ],
    // No Data Source: leave the metric fields alone
    ...(ctx.datasource
      ? {
          datasource: ctx.datasource.id,
          exposureQueryId: "",
          goalMetrics: metrics.filter((m) => m.is_primary).map((m) => m.id),
          secondaryMetrics: metrics
            .filter((m) => !m.is_primary && !m.is_guardrail)
            .map((m) => m.id),
          guardrailMetrics: metrics
            .filter((m) => !m.is_primary && m.is_guardrail)
            .map((m) => m.id),
        }
      : {}),
    ...(status === "stopped" && experiment.outcome
      ? {
          results: RESULTS[experiment.outcome],
          winner: winner >= 0 ? winner : undefined,
        }
      : {}),
    analysis: experiment.key_takeaways ?? "",
    // Org defaults unless Eppo has a plan; Sequential* means sequential
    ...(plan
      ? {
          statsEngine: method === "Bayesian" ? "bayesian" : "frequentist",
          sequentialTestingEnabled: !!method?.startsWith("Sequential"),
          regressionAdjustmentEnabled: !!plan.compute_cuped,
        }
      : {}),
  };
}

// Tags and project stay; a running experiment only takes copy changes
export function toExperimentUpdate(
  experiment: Partial<ExperimentInterfaceStringDates>,
  running: boolean,
) {
  const { phases, ...rest } = experiment;
  const copy = pick(rest, ["name", "hypothesis", "analysis"]);
  if (running) return { update: copy, phase: undefined };
  return {
    update: {
      ...copy,
      ...pick(rest, [
        "status",
        "datasource",
        "exposureQueryId",
        "variations",
        "goalMetrics",
        "secondaryMetrics",
        "guardrailMetrics",
        "results",
        "winner",
        "statsEngine",
        "sequentialTestingEnabled",
        "regressionAdjustmentEnabled",
      ]),
    },
    phase: phases?.[0],
  };
}

// The phase endpoint takes UTC dates as "yyyy-MM-ddTHH:mm"
export function toPhaseDate(date?: string): string {
  return date ? new Date(date).toISOString().slice(0, 16) : "";
}

// Eppo's settings over the existing phase; GrowthBook-only fields survive
export function mergePhase(
  existing: ExperimentPhaseStringDates,
  incoming: ExperimentPhaseStringDates,
) {
  const targeted = !!incoming.condition || !!incoming.savedGroups?.length;
  return {
    ...existing,
    ...(targeted
      ? { condition: incoming.condition, savedGroups: incoming.savedGroups }
      : {}),
    coverage: incoming.coverage,
    variationWeights: incoming.variationWeights,
    variations: incoming.variations,
    dateStarted: toPhaseDate(incoming.dateStarted || existing.dateStarted),
    dateEnded: toPhaseDate(incoming.dateEnded || existing.dateEnded),
  };
}

// region Import

export type ImportStatus = "pending" | "invalid" | "completed" | "failed";

// Matched via a previous run, or only by name/key
export type ImportMatch = "run" | "name";

export type ImportItem<T> = {
  key: string;
  name: string;
  eppo: T;
  // GrowthBook id when it already exists
  existingId?: string;
  match?: ImportMatch;
  status: ImportStatus;
  error?: string;
  preview?: unknown;
};

export type ImportResult = Pick<ImportItem<unknown>, "status" | "error">;

export type EppoImportData = {
  environments: ImportItem<EppoEnvironment>[];
  tags: ImportItem<EppoTag>[];
  audiences: ImportItem<EppoAudience>[];
  factSources: ImportItem<EppoFactSource>[];
  metrics: ImportItem<EppoMetric>[];
  experiments: ImportItem<EppoExperiment>[];
  flags: ImportItem<EppoFlag>[];
};

export type EppoCategory = keyof EppoImportData;

// Import order: later categories reference earlier ones
export const CATEGORIES: { key: EppoCategory; label: string }[] = [
  { key: "environments", label: "Environments" },
  { key: "tags", label: "Tags" },
  { key: "audiences", label: "Audiences → Saved Groups" },
  { key: "factSources", label: "Fact sources → Fact Tables" },
  { key: "metrics", label: "Metrics → Fact Metrics" },
  { key: "experiments", label: "Experiments" },
  { key: "flags", label: "Feature Flags" },
];

export const ARTIFACT_KINDS: Record<EppoCategory, AutoRunArtifact["kind"]> = {
  environments: "environment",
  tags: "tag",
  audiences: "saved-group",
  factSources: "fact-table",
  metrics: "metric",
  experiments: "experiment",
  flags: "feature",
};

export const EPPO_RUN_SOURCE = "eppo-import";
const RECORD_CHUNK = 200;

type ArtifactAction = NonNullable<AutoRunArtifact["action"]>;

function artifactAction(
  category: EppoCategory,
  item: ImportItem<unknown>,
): { action: ArtifactAction; detail: string } {
  if (!item.existingId) {
    return { action: "created", detail: "Created from Eppo" };
  }
  if (category === "environments" || category === "tags") {
    return { action: "existing", detail: "Already in GrowthBook" };
  }
  return { action: "updated", detail: "Updated from Eppo" };
}

// Reverse import order so references are deleted first
const TEARDOWN_ORDER: AutoRunArtifact["kind"][] = [
  "feature",
  "experiment",
  "metric",
  "fact-table",
  "saved-group",
  "environment",
  "tag",
];

// Runs recorded before `action` carry it in `detail`
export const wasCreated = (a: ApiAutoRun["artifacts"][number]) =>
  a.action === "created" || (!a.action && a.detail === "Created from Eppo");

export function createdByRun(run: ApiAutoRun): ApiAutoRun["artifacts"] {
  return run.artifacts
    .filter(wasCreated)
    .sort(
      (a, b) => TEARDOWN_ORDER.indexOf(a.kind) - TEARDOWN_ORDER.indexOf(b.kind),
    );
}

const wasUpdated = (a: ApiAutoRun["artifacts"][number]) =>
  a.action === "updated" || (!a.action && a.detail === "Updated from Eppo");

// Created here and updated by a later run; teardown deletes these too
export function updatedByLaterRuns(
  run: ApiAutoRun,
  runs: ApiAutoRun[],
): ApiAutoRun["artifacts"] {
  const updated = new Set(
    runs
      .filter((r) => r.source === run.source && r.dateCreated > run.dateCreated)
      .flatMap((r) => r.artifacts.filter(wasUpdated))
      .map((a) => `${a.kind}:${a.id}`),
  );
  return createdByRun(run).filter((a) => updated.has(`${a.kind}:${a.id}`));
}

async function deleteArtifact(
  artifact: ApiAutoRun["artifacts"][number],
  apiCall: ApiCall,
) {
  const id = encodeURIComponent(artifact.id);
  switch (artifact.kind) {
    case "feature": {
      // Archive first (autoPublish lands it now); restore the original state if the delete fails
      const { feature } = await apiCall<{ feature: { archived?: boolean } }>(
        `/feature/${id}`,
      );
      const archive = (archived: boolean) =>
        apiCall(`/feature/${id}/archive`, {
          method: "POST",
          body: JSON.stringify({
            archived,
            autoPublish: true,
            ignoreWarnings: true,
          }),
        });
      if (!feature.archived) await archive(true);
      try {
        await apiCall(`/feature/${id}`, { method: "DELETE" });
      } catch (e) {
        if (!feature.archived) await archive(false).catch(() => undefined);
        throw e;
      }
      return;
    }
    case "experiment":
      await apiCall(`/experiment/${id}`, { method: "DELETE" });
      return;
    case "metric":
      await apiCall(`/fact-metrics/${id}`, { method: "DELETE" });
      return;
    case "fact-table":
      await apiCall(`/fact-tables/${id}`, { method: "DELETE" });
      return;
    case "saved-group": {
      const { savedGroup } = await apiCall<{
        savedGroup: { archived?: boolean };
      }>(`/saved-groups/${id}`);
      const archive = (archived: boolean) =>
        apiCall(`/saved-groups/${id}`, {
          method: "PUT",
          body: JSON.stringify({ archived }),
        });
      if (!savedGroup.archived) await archive(true);
      try {
        await apiCall(`/saved-groups/${id}`, { method: "DELETE" });
      } catch (e) {
        // Restore, or the archived group would import twice
        if (!savedGroup.archived) await archive(false).catch(() => undefined);
        throw e;
      }
      return;
    }
    case "environment":
      await apiCall(`/environment/${id}`, { method: "DELETE" });
      return;
    case "tag":
      await apiCall("/tag", {
        method: "DELETE",
        body: JSON.stringify({ id: artifact.id }),
      });
      return;
    case "sdk-connection":
    case "attribute":
      throw new Error(`Can't delete a ${artifact.kind}`);
  }
}

export type TeardownFailure = {
  artifact: ApiAutoRun["artifacts"][number];
  error: string;
};

// Kinds that must stay when something referencing them couldn't be deleted
const KEPT_WHEN_FAILED: Partial<
  Record<AutoRunArtifact["kind"], AutoRunArtifact["kind"][]>
> = {
  feature: ["experiment", "saved-group", "environment"],
  experiment: ["metric"],
  metric: ["fact-table"],
};

// One at a time so one blocked delete doesn't stop the rest
export async function teardownRun(
  run: ApiAutoRun,
  apiCall: ApiCall,
): Promise<{ deleted: number; failures: TeardownFailure[] }> {
  const failures: TeardownFailure[] = [];
  const kept = new Set<AutoRunArtifact["kind"]>();
  let deleted = 0;
  for (const artifact of createdByRun(run)) {
    if (kept.has(artifact.kind)) {
      failures.push({
        artifact,
        error: "Kept because something that uses it couldn't be deleted",
      });
      continue;
    }
    try {
      await deleteArtifact(artifact, apiCall);
      await apiCall(`/auto-runs/${run.id}/artifacts`, {
        method: "POST",
        body: JSON.stringify({
          artifacts: [
            {
              kind: artifact.kind,
              id: artifact.id,
              label: artifact.label,
              by: artifact.by,
              detail: "Deleted",
              externalId: artifact.externalId ?? null,
              action: "deleted",
            },
          ],
        }),
      });
      deleted++;
    } catch (e) {
      failures.push({ artifact, error: e.message });
      KEPT_WHEN_FAILED[artifact.kind]?.forEach((k) => kept.add(k));
    }
  }
  return { deleted, failures };
}

// Eppo id -> GrowthBook id, from previous runs
export type ImportedIds = Record<
  Exclude<EppoCategory, "environments" | "tags">,
  Map<number, string>
>;

export function externalId(category: EppoCategory, eppoId: number): string {
  return `${category}:${eppoId}`;
}

// Later runs win; deleted objects drop out so they're created again
export function getImportedIds(
  runs: ApiAutoRun[],
  exists: (kind: AutoRunArtifact["kind"], id: string) => boolean,
): ImportedIds {
  const ids: ImportedIds = {
    audiences: new Map(),
    factSources: new Map(),
    metrics: new Map(),
    experiments: new Map(),
    flags: new Map(),
  };
  runs
    .filter((r) => r.source === EPPO_RUN_SOURCE)
    .sort((a, b) => a.dateCreated.localeCompare(b.dateCreated))
    .forEach((run) => {
      run.artifacts.forEach((a) => {
        const [category, eppoId] = (a.externalId ?? "").split(":");
        if (!(category in ids) || !eppoId) return;
        const key = category as keyof ImportedIds;
        if (a.action === "failed") return;
        if (a.action === "deleted" || !exists(a.kind, a.id)) {
          ids[key].delete(Number(eppoId));
          return;
        }
        ids[key].set(Number(eppoId), a.id);
      });
    });
  return ids;
}

export type ExistingIds = {
  environments: Set<string>;
  tags: Set<string>;
  imported: ImportedIds;
  // Name matches in scope that no run created; never applied by default
  savedGroups: Map<string, string>; // name
  features: Set<string>; // key, in any project
  factTables: Map<string, string>; // name, on the selected Data Source
  factMetrics: Map<string, string>; // name, on the selected Data Source
  experiments: Map<string, string>; // tracking key
  experimentRefs: Map<string, Pick<GBExperimentRef, "variations" | "status">>; // id
  factTableColumns: Map<string, string[]>; // Fact Table id
};

export function getColumnNames(
  columns: Pick<ColumnInterface, "column" | "deleted">[],
): string[] {
  return columns.filter((c) => !c.deleted).map((c) => c.column);
}

export type ItemMatch = Pick<ImportItem<unknown>, "existingId" | "match">;

function findMatch(
  imported: Map<number, string>,
  eppoId: number,
  byName: string | undefined,
): ItemMatch {
  const runId = imported.get(eppoId);
  if (runId) return { existingId: runId, match: "run" };
  if (byName) return { existingId: byName, match: "name" };
  return {};
}

export const experimentTrackingKey = (e: EppoExperiment) =>
  e.experiment_key || `eppo_${e.id}`;

// Computed before transforms so the selection can default from it
export function matchItems(
  eppo: EppoData,
  existing: ExistingIds,
): Record<EppoCategory, Map<string, ItemMatch>> {
  const { imported } = existing;
  const byId = <T extends { id: number; name: string }>(
    items: T[],
    imp: Map<number, string>,
    byName: (item: T) => string | undefined,
  ) =>
    new Map(items.map((i) => [String(i.id), findMatch(imp, i.id, byName(i))]));
  return {
    environments: new Map(
      eppo.environments.map((e) => {
        const id = toEnvironmentId(e.name);
        return [
          id,
          existing.environments.has(id) ? { existingId: id, match: "run" } : {},
        ];
      }),
    ),
    tags: new Map(
      eppo.tags.map((t) => [
        t.name,
        existing.tags.has(t.name) ? { existingId: t.name, match: "run" } : {},
      ]),
    ),
    audiences: byId(eppo.audiences, imported.audiences, (a) =>
      existing.savedGroups.get(a.name),
    ),
    factSources: byId(eppo.factSources, imported.factSources, (f) =>
      existing.factTables.get(f.name),
    ),
    metrics: byId(eppo.metrics, imported.metrics, (m) =>
      existing.factMetrics.get(m.name),
    ),
    experiments: byId(eppo.experiments, imported.experiments, (e) =>
      existing.experiments.get(experimentTrackingKey(e)),
    ),
    flags: new Map(
      eppo.flags.map((f) => [
        f.key,
        findMatch(
          imported.flags,
          f.id,
          existing.features.has(f.key) ? f.key : undefined,
        ),
      ]),
    ),
  };
}

function buildItem<T>(
  key: string,
  name: string,
  eppo: T,
  match: ItemMatch,
  transform: () => unknown,
): ImportItem<T> {
  try {
    return {
      key,
      name,
      eppo,
      ...match,
      status: "pending",
      preview: transform(),
    };
  } catch (e) {
    return { key, name, eppo, ...match, status: "invalid", error: e.message };
  }
}

export type Selection = (category: EppoCategory, key: string) => boolean;

function getEnvironmentIds(
  eppo: EppoData,
  existing: ExistingIds,
  isSelected: Selection,
): Set<string> {
  const ids = new Set(existing.environments);
  eppo.environments.forEach((e) => {
    const id = toEnvironmentId(e.name);
    if (id && isSelected("environments", id)) ids.add(id);
  });
  return ids;
}

// Ids for matching existing GrowthBook entities, with placeholders for ones the
// import would create so previews can resolve references
function getInitialContext(
  eppo: EppoData,
  existing: ExistingIds,
  matches: Record<EppoCategory, Map<string, ItemMatch>>,
  project: string,
  datasource: DataSourceInterfaceWithParams | null,
  isSelected: Selection,
  placeholder?: string,
): TransformContext {
  const ids = <T extends { id: number }>(
    category: Exclude<EppoCategory, "environments" | "tags" | "flags">,
    items: T[],
    valid: (item: T) => boolean = () => true,
  ) =>
    new Map(
      items.flatMap((item) => {
        const key = String(item.id);
        const id =
          matches[category].get(key)?.existingId ??
          (placeholder && isSelected(category, key) && valid(item)
            ? placeholder
            : undefined);
        return id ? [[item.id, id] as const] : [];
      }),
    );
  const savedGroupIds = ids(
    "audiences",
    eppo.audiences,
    (a) => !!rulesToCondition(a.targeting_rules ?? []),
  );
  const factTableIds = ids("factSources", eppo.factSources, () => !!datasource);
  const metricIds = ids("metrics", eppo.metrics);
  const experiments = new Map<number, GBExperimentRef>();
  eppo.experiments.forEach((e) => {
    const existingId = matches.experiments.get(String(e.id))?.existingId;
    const variations = e.variations
      .filter((v) => v.is_active)
      .map((v) => ({ key: v.variant_key, id: `var_eppo_${v.variation_id}` }));
    if (existingId) {
      const ref = existing.experimentRefs.get(existingId);
      experiments.set(e.id, {
        id: existingId,
        status: ref?.status,
        variations: ref?.variations ?? variations,
      });
    } else if (placeholder && isSelected("experiments", String(e.id))) {
      const active = e.variations
        .filter((v) => v.is_active)
        .sort((a, b) => Number(b.is_control) - Number(a.is_control));
      const total = active.reduce(
        (sum, v) => sum + (v.weighted_expected_traffic || 0),
        0,
      );
      const targeting = getLinkedTargeting(e.id, {
        eppo,
        project,
        datasource,
        environmentIds: new Set(),
        savedGroupIds,
        factTableIds,
        metricIds,
        experiments,
        factTableColumns: new Map(),
      });
      experiments.set(e.id, {
        id: placeholder,
        status: e.status === "RUNNING" ? "running" : undefined,
        variations: active.map((v) => ({
          key: v.variant_key,
          id: `var_eppo_${v.variation_id}`,
        })),
        phase: targeting
          ? {
              ...targeting,
              variationWeights: active.map((v) =>
                total
                  ? (v.weighted_expected_traffic || 0) / total
                  : 1 / active.length,
              ),
            }
          : undefined,
      });
    }
  });
  return {
    eppo,
    project,
    datasource,
    environmentIds: getEnvironmentIds(eppo, existing, isSelected),
    savedGroupIds,
    factTableIds,
    metricIds,
    experiments,
    factTableColumns: new Map(existing.factTableColumns),
  };
}

export function buildImportData(
  eppo: EppoData,
  existing: ExistingIds,
  matches: Record<EppoCategory, Map<string, ItemMatch>>,
  project: string,
  datasource: DataSourceInterfaceWithParams | null,
  isSelected: Selection,
): EppoImportData {
  const ctx = getInitialContext(
    eppo,
    existing,
    matches,
    project,
    datasource,
    isSelected,
    "(new)",
  );
  const match = (category: EppoCategory, key: string) =>
    matches[category].get(key) ?? {};
  return {
    environments: eppo.environments.map((e) => {
      const id = toEnvironmentId(e.name);
      return buildItem(id, e.name, e, match("environments", id), () => {
        if (!id) throw new Error("Environment name has no usable characters");
        return { id, description: e.name };
      });
    }),
    tags: eppo.tags.map((t) =>
      buildItem(t.name, t.name, t, match("tags", t.name), () => ({
        id: t.name,
        description: t.description ?? "",
      })),
    ),
    audiences: eppo.audiences.map((a) =>
      buildItem(String(a.id), a.name, a, match("audiences", String(a.id)), () =>
        transformAudience(a, project),
      ),
    ),
    factSources: eppo.factSources.map((f) =>
      buildItem(
        String(f.id),
        f.name,
        f,
        match("factSources", String(f.id)),
        () => transformFactSource(f, ctx),
      ),
    ),
    metrics: eppo.metrics.map((m) =>
      buildItem(String(m.id), m.name, m, match("metrics", String(m.id)), () =>
        transformMetric(m, ctx),
      ),
    ),
    experiments: eppo.experiments.map((e) =>
      buildItem(
        String(e.id),
        e.name,
        e,
        match("experiments", String(e.id)),
        () => transformExperiment(e, ctx, ctx.experiments.get(e.id)),
      ),
    ),
    flags: eppo.flags.map((f) =>
      buildItem(f.key, f.key, f, match("flags", f.key), () =>
        transformFlag(f, ctx),
      ),
    ),
  };
}

export type EppoImportOutcome = {
  runId: string;
  completed: number;
  failed: number;
};

export async function runEppoImport({
  data,
  eppo,
  isSelected,
  existing,
  project,
  datasource,
  attributeSchema,
  apiCall,
  setItem,
}: {
  data: EppoImportData;
  eppo: EppoData;
  isSelected: Selection;
  existing: ExistingIds;
  project: string;
  datasource: DataSourceInterfaceWithParams | null;
  attributeSchema: SDKAttribute[];
  apiCall: ApiCall;
  setItem: (category: EppoCategory, key: string, update: ImportResult) => void;
}): Promise<EppoImportOutcome> {
  const ctx = getInitialContext(
    eppo,
    existing,
    matchItems(eppo, existing),
    project,
    datasource,
    isSelected,
  );
  const PQueue = (await import("p-queue")).default;
  const parallel = new PQueue({ concurrency: 6 });

  const selected = <T>(category: EppoCategory, items: ImportItem<T>[]) =>
    items.filter(
      (item) => item.status !== "invalid" && isSelected(category, item.key),
    );
  const selectedCount = CATEGORIES.reduce(
    (n, { key }) => n + selected(key, data[key]).length,
    0,
  );
  if (selectedCount > MAX_AUTO_RUN_ARTIFACTS) {
    throw new Error(
      `Select at most ${MAX_AUTO_RUN_ARTIFACTS} items per import so the run can record them all`,
    );
  }

  // The run is what a re-run reads to update instead of re-create
  const { autoRun } = await apiCall<{ autoRun: ApiAutoRun }>("/auto-runs", {
    method: "POST",
    body: JSON.stringify({
      source: EPPO_RUN_SOURCE,
      metadata: {
        project,
        datasource: datasource?.id ?? "",
        selected: selectedCount,
      },
    }),
  });
  const runId = autoRun.id;
  const outcome: EppoImportOutcome = { runId, completed: 0, failed: 0 };

  // One append per category, so items don't race on the run document
  type Recorded = {
    item: ImportItem<{ id: number }>;
    id: string;
    error?: string;
  };
  let recorded: Recorded[] = [];
  const record = <T extends { id: number }>(
    item: ImportItem<T>,
    id: string,
  ) => {
    recorded.push({ item, id });
  };
  const flushRecorded = async (category: EppoCategory) => {
    const kind = ARTIFACT_KINDS[category];
    const batch = recorded;
    recorded = [];
    if (!batch.length) return;
    try {
      for (let i = 0; i < batch.length; i += RECORD_CHUNK) {
        await apiCall(`/auto-runs/${runId}/artifacts`, {
          method: "POST",
          body: JSON.stringify({
            artifacts: batch
              .slice(i, i + RECORD_CHUNK)
              .map(({ item, id, error }) => ({
                kind,
                id,
                label: item.name.slice(0, 200),
                by: "growthbook",
                ...(error
                  ? { action: "failed", detail: error.slice(0, 500) }
                  : artifactAction(category, item)),
                externalId: externalId(category, item.eppo.id),
              })),
          }),
        });
      }
    } catch (e) {
      // The objects exist but aren't recorded, so say so
      batch.forEach(({ item, error }) => {
        if (error) return;
        outcome.completed--;
        outcome.failed++;
        setItem(category, item.key, {
          status: "failed",
          error: `Imported, but couldn't be recorded in the run report: ${e.message}`,
        });
      });
    }
  };

  // Create requires an owner (empty = importer); updates never send it
  const created = <T extends object>(payload: T) => ({ ...payload, owner: "" });

  const importEach = async <T extends { id: number }>(
    category: EppoCategory,
    items: ImportItem<T>[],
    importItem: (item: ImportItem<T>) => Promise<unknown>,
    // Serial for writes that rewrite one shared document
    { serial = false } = {},
  ) => {
    const queue = serial ? new PQueue({ concurrency: 1 }) : parallel;
    selected(category, items).forEach((item) => {
      setItem(category, item.key, { status: "pending", error: undefined });
      queue.add(async () => {
        try {
          await importItem(item);
          outcome.completed++;
          setItem(category, item.key, { status: "completed" });
        } catch (e) {
          outcome.failed++;
          setItem(category, item.key, { status: "failed", error: e.message });
          // Recorded as failed; the id is the Eppo reference
          recorded.push({
            item,
            id: item.existingId ?? externalId(category, item.eppo.id),
            error: e.message,
          });
        }
      });
    });
    await queue.onIdle();
    await flushRecorded(category);
  };

  try {
    // Rules can't reference attributes that don't exist yet
    const attributes = new Set([
      "id",
      ...selected("audiences", data.audiences).flatMap((a) =>
        getTargetingAttributes(a.eppo.targeting_rules ?? []),
      ),
      ...selected("flags", data.flags).flatMap((f) =>
        getFlagAttributes(f.eppo, eppo),
      ),
      ...selected("experiments", data.experiments).flatMap((e) =>
        eppo.flags.flatMap((f) =>
          (f.allocations ?? []).some((a) => a.experiment?.id === e.eppo.id)
            ? getFlagAttributes(f, eppo)
            : [],
        ),
      ),
    ]);
    for (const attribute of attributes) {
      await ensureAttributeExists(attribute, attributeSchema, apiCall);
    }

    // Serial, one env per call: each rewrites the org list
    const createdEnvs = new Set<string>();
    await importEach(
      "environments",
      data.environments,
      async (item) => {
        if (!item.existingId) {
          await apiCall("/environment", {
            method: "PUT",
            body: JSON.stringify({
              environments: [{ id: item.key, description: item.eppo.name }],
            }),
          });
          createdEnvs.add(item.key);
        }
        record(item, item.key);
      },
      { serial: true },
    );
    // Envs the plan refused drop out of the rules
    ctx.environmentIds = new Set([...existing.environments, ...createdEnvs]);

    await importEach("tags", data.tags, async (item) => {
      if (!item.existingId) {
        await apiCall("/tag", {
          method: "POST",
          body: JSON.stringify({
            id: item.key,
            description: item.eppo.description ?? "",
            color: "blue",
          }),
        });
      }
      record(item, item.key);
    });

    // Drop references to items that failed, so dependents fall back
    const dropOnFailure = async <K>(
      refs: Map<K, unknown>,
      key: K,
      run: () => Promise<void>,
    ) => {
      try {
        await run();
      } catch (e) {
        refs.delete(key);
        throw e;
      }
    };

    await importEach("audiences", data.audiences, (item) =>
      dropOnFailure(ctx.savedGroupIds, item.eppo.id, async () => {
        const group = transformAudience(item.eppo, project);
        let id = item.existingId;
        if (id) {
          await apiCall(`/saved-groups/${id}`, {
            method: "PUT",
            body: JSON.stringify(pick(group, ["groupName", "condition"])),
          });
        } else {
          const res = await apiCall<{ savedGroup: SavedGroupInterface }>(
            "/saved-groups",
            { method: "POST", body: JSON.stringify(created(group)) },
          );
          id = res.savedGroup.id;
        }
        ctx.savedGroupIds.set(item.eppo.id, id);
        record(item, id);
      }),
    );

    await importEach("factSources", data.factSources, (item) =>
      dropOnFailure(ctx.factTableIds, item.eppo.id, async () => {
        const factTable = transformFactSource(item.eppo, ctx);
        let saved: FactTableInterface;
        if (item.existingId) {
          await apiCall(`/fact-tables/${item.existingId}`, {
            method: "PUT",
            body: JSON.stringify(toFactTableUpdate(factTable)),
          });
          // Fetched again since a SQL change re-detects the columns
          saved = (
            await apiCall<{ factTable: FactTableInterface }>(
              `/fact-tables/${item.existingId}`,
            )
          ).factTable;
        } else {
          saved = (
            await apiCall<{ factTable: FactTableInterface }>("/fact-tables", {
              method: "POST",
              body: JSON.stringify(created(factTable)),
            })
          ).factTable;
        }
        ctx.factTableIds.set(item.eppo.id, saved.id);
        ctx.factTableColumns.set(saved.id, getColumnNames(saved.columns));
        record(item, saved.id);
      }),
    );

    await importEach("metrics", data.metrics, (item) =>
      dropOnFailure(ctx.metricIds, item.eppo.id, async () => {
        const metric = transformMetric(item.eppo, ctx);
        let id = item.existingId;
        if (id) {
          await apiCall(`/fact-metrics/${id}`, {
            method: "PUT",
            body: JSON.stringify(toMetricUpdate(metric)),
          });
        } else {
          const res = await apiCall<{ factMetric: FactMetricInterface }>(
            "/fact-metrics",
            { method: "POST", body: JSON.stringify(created(metric)) },
          );
          id = res.factMetric.id;
        }
        ctx.metricIds.set(item.eppo.id, id);
        record(item, id);
      }),
    );

    await importEach("experiments", data.experiments, (item) =>
      dropOnFailure(ctx.experiments, item.eppo.id, async () => {
        let id = item.existingId;
        let current: ExperimentInterfaceStringDates | null = null;
        if (id) {
          current = (
            await apiCall<{ experiment: ExperimentInterfaceStringDates }>(
              `/experiment/${id}`,
            )
          ).experiment;
        }
        const existingRef: GBExperimentRef | undefined = current
          ? { id: current.id, variations: current.variations }
          : undefined;
        const experiment = transformExperiment(item.eppo, ctx, existingRef);

        if (!id) {
          const res = await apiCall<{
            experiment?: ExperimentInterfaceStringDates;
            duplicateTrackingKey?: boolean;
            existingId?: string;
          }>("/experiments", {
            method: "POST",
            body: JSON.stringify(experiment),
          });
          if (res.duplicateTrackingKey) {
            throw new Error(
              "An experiment with this tracking key already exists in GrowthBook",
            );
          }
          if (!res.experiment) throw new Error("Experiment wasn't created");
          current = res.experiment;
          id = current.id;
        } else if (current) {
          const { update, phase } = toExperimentUpdate(
            experiment,
            current.status === "running",
          );
          const res = await apiCall<{
            experiment?: ExperimentInterfaceStringDates | null;
          }>(`/experiment/${id}`, {
            method: "POST",
            body: JSON.stringify(update),
          });
          current = res.experiment ?? current;
          // Stopping is its own endpoint; it lands the outcome and end date
          if (current.status === "running" && experiment.status === "stopped") {
            await apiCall(`/experiment/${id}/stop`, {
              method: "POST",
              body: JSON.stringify({
                reason: "",
                dateEnded: toPhaseDate(experiment.phases?.[0]?.dateEnded),
                results: experiment.results,
                winner: experiment.winner,
                analysis: experiment.analysis,
                excludeFromPayload: true,
              }),
            });
            current = { ...current, status: "stopped" };
          }
          const last = current.phases.length - 1;
          if (phase && last >= 0) {
            const merged = mergePhase(current.phases[last], phase);
            await apiCall(`/experiment/${id}/phase/${last}`, {
              method: "PUT",
              body: JSON.stringify(merged),
            });
            current = {
              ...current,
              phases: [...current.phases.slice(0, last), { ...merged }],
            };
          }
        }
        const livePhase = current?.phases[current.phases.length - 1];
        ctx.experiments.set(item.eppo.id, {
          id,
          status: current?.status,
          variations: current?.variations ?? [],
          phase: livePhase && {
            condition: livePhase.condition ?? "",
            savedGroups: livePhase.savedGroups ?? [],
            coverage: livePhase.coverage ?? 1,
            variationWeights: livePhase.variationWeights,
          },
        });
        record(item, id);
      }),
    );

    await importEach("flags", data.flags, async (item) => {
      const flag = transformFlag(item.eppo, ctx);
      await apiCall(
        `/feature/${encodeURIComponent(item.key)}/sync?mirror=true`,
        {
          method: "POST",
          body: JSON.stringify(item.existingId ? toFlagUpdate(flag) : flag),
        },
      );
      record(item, item.key);
    });
  } finally {
    await apiCall(`/auto-runs/${runId}`, {
      method: "PUT",
      body: JSON.stringify({
        outcome: outcome.failed
          ? outcome.completed
            ? "partial"
            : "failed"
          : "completed",
        metadata: {
          project,
          datasource: datasource?.id ?? "",
          selected: selectedCount,
          completed: outcome.completed,
          failed: outcome.failed,
        },
      }),
    }).catch(() => undefined);
  }

  return outcome;
}

// endregion Import
