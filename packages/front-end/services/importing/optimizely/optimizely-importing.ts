import { escapeRegExp, pick } from "lodash";
import md5 from "md5";
import { FeatureRule, FeatureValueType } from "shared/types/feature";
import { SavedGroupInterface } from "shared/types/saved-group";
import { ColumnRef, FactMetricInterface } from "shared/types/fact-table";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { SDKAttribute } from "shared/types/organization";
import {
  ApiAutoRun,
  AutoRunArtifact,
  MAX_AUTO_RUN_ARTIFACTS,
} from "shared/validators";
import {
  DEFAULT_MAX_PERCENT_CHANGE,
  DEFAULT_MIN_PERCENT_CHANGE,
  DEFAULT_MIN_SAMPLE_SIZE,
  DEFAULT_PROPER_PRIOR_STDDEV,
  DEFAULT_TARGET_MDE,
} from "shared/constants";
import { ensureAttributeExists } from "@/services/importing/statsig/transformers/attributeCreator";
import {
  ApiCall,
  FactMetricPayload,
  FeaturePayload,
  ImportResult,
  ItemMatch,
  PhaseTargeting,
  toEnvironmentId,
  toFlagUpdate,
  toMetricUpdate,
} from "@/services/importing/eppo/eppo-importing";

// Shapes from Optimizely's REST API v2 (projects, environments, audiences,
// events) and Flags API v1 (flags, variations, rulesets). Only the fields the
// importer reads.

export type OptimizelyProject = {
  id: number;
  name: string;
  is_flags_enabled?: boolean;
};

export type OptimizelyEnvironment = {
  id: number;
  key: string;
  name: string;
  archived?: boolean;
  is_primary?: boolean;
  priority?: number;
};

export type OptimizelyAudience = {
  id: number;
  name: string;
  description?: string;
  archived?: boolean;
  // JSON-encoded condition tree
  conditions: string;
};

export type OptimizelyEvent = {
  id: number;
  key: string;
  name?: string;
  archived?: boolean;
};

type OptimizelyPropertyFilter = {
  combine_operator?: "and" | "or";
  conditions?: { name: string; operator: string; value: unknown }[];
};

type OptimizelySubMetric = {
  aggregator: string;
  event_id?: number | null;
  field?: string | null;
  scope?: string;
  role?: "numerator" | "denominator";
  event_properties?: { filter?: OptimizelyPropertyFilter } | null;
};

export type OptimizelyMetric = OptimizelySubMetric & {
  winning_direction?: "increasing" | "decreasing";
  display_title?: string;
  // Ratio metrics only
  metrics?: OptimizelySubMetric[];
};

export type OptimizelyRule = {
  id?: number;
  key: string;
  name?: string;
  type: string;
  enabled?: boolean;
  archived?: boolean;
  status?: "draft" | "running" | "paused" | "concluded";
  hypothesis?: string;
  // Basis points (0-10000) of the audience
  percentage_included?: number;
  // [] or "everyone", else ["or", { audience_id }, ...]
  audience_conditions?: unknown[] | string;
  variations?: Record<
    string,
    {
      key: string;
      name?: string;
      percentage_included?: number;
      variation_id?: number;
      id?: number;
    }
  >;
  baseline_variation_id?: number | null;
  metrics?: OptimizelyMetric[];
  allow_list?: Record<
    string,
    { user_id?: string; variation?: { key?: string } }
  >;
};

export type OptimizelyRuleset = {
  enabled?: boolean;
  rule_priorities?: string[];
  rules?: Record<string, OptimizelyRule>;
  default_variation_key?: string;
};

export type OptimizelyVariation = {
  id?: number;
  key: string;
  name?: string;
  archived?: boolean;
  enabled?: boolean;
  variables?: Record<string, { value?: string }>;
};

export type OptimizelyFlag = {
  id: number;
  key: string;
  name: string;
  description?: string;
  archived?: boolean;
  variable_definitions?: Record<
    string,
    { key: string; type: string; default_value?: string }
  >;
  // Fetched per flag and attached here
  variations: OptimizelyVariation[];
  // By environment key
  rulesets: Record<string, OptimizelyRuleset>;
};

export type OptimizelyData = {
  project: OptimizelyProject;
  // Primary environment first
  environments: OptimizelyEnvironment[];
  audiences: OptimizelyAudience[];
  events: OptimizelyEvent[];
  flags: OptimizelyFlag[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getFromOptimizely<T>(
  endpoint: string,
  apiToken: string,
  apiCall: ApiCall,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await apiCall<T>("/importing/optimizely", {
        method: "POST",
        body: JSON.stringify({ endpoint, apiToken }),
      });
    } catch (e) {
      if (attempt < 3 && /429|too many requests/i.test(e.message)) {
        await sleep(20000);
        continue;
      }
      throw new Error(`Optimizely /${endpoint}: ${e.message}`);
    }
  }
}

const V2_PAGE_SIZE = 100;

// `?dummy=true` on the importer page swaps Optimizely for hard-coded data
export const isDummyImport = () =>
  typeof location !== "undefined" && location.search.includes("dummy=true");

export async function fetchOptimizelyData(
  apiToken: string,
  projectId: string,
  apiCall: ApiCall,
  onProgress: (done: number, total: number) => void = () => undefined,
): Promise<OptimizelyData> {
  if (isDummyImport()) {
    return (await import("./dummy")).DUMMY_OPTIMIZELY_DATA;
  }
  if (!/^\d+$/.test(projectId)) {
    throw new Error("The Optimizely project ID is a number");
  }
  const get = <T>(endpoint: string) =>
    getFromOptimizely<T>(endpoint, apiToken, apiCall);

  const project = await get<OptimizelyProject>(`v2/projects/${projectId}`);
  if (!project.is_flags_enabled) {
    throw new Error(
      "Only Feature Experimentation projects can be imported. This project doesn't use flags.",
    );
  }

  const getAllV2 = async <T>(resource: string): Promise<T[]> => {
    const all: T[] = [];
    for (let page = 1; page <= 200; page++) {
      const items = await get<T[]>(
        `v2/${resource}?project_id=${projectId}&per_page=${V2_PAGE_SIZE}&page=${page}`,
      );
      if (!Array.isArray(items)) {
        throw new Error(`Unexpected response from Optimizely /v2/${resource}`);
      }
      all.push(...items);
      if (items.length < V2_PAGE_SIZE) break;
    }
    return all;
  };

  // ponytail: the Flags API allows 2 requests/second and needs one call per
  // flag plus one per flag and environment, so a large project takes minutes.
  // Reading each environment's datafile instead is a handful of calls if this
  // gets too slow.
  const PQueue = (await import("p-queue")).default;
  const flagsQueue = new PQueue({
    concurrency: 2,
    interval: 1100,
    intervalCap: 2,
  });
  const getFlagsApi = <T>(path: string) =>
    flagsQueue.add(() => get<T>(`flags/v1${path}`)) as Promise<T>;
  const getAllFlagsApi = async <T>(path: string): Promise<T[]> => {
    const all: T[] = [];
    let next: string | undefined = path;
    for (let page = 0; next && page < 200; page++) {
      const res: { items?: T[]; next_url?: string[] } = await getFlagsApi(next);
      all.push(...(res.items ?? []));
      next = res.next_url?.[0];
    }
    return all;
  };

  const [environments, audiences, events, flags] = await Promise.all([
    getAllV2<OptimizelyEnvironment>("environments"),
    getAllV2<OptimizelyAudience>("audiences"),
    getAllV2<OptimizelyEvent>("events"),
    getAllFlagsApi<Omit<OptimizelyFlag, "variations" | "rulesets">>(
      `/projects/${projectId}/flags?archived=false`,
    ),
  ]);

  const liveEnvironments = environments
    .filter((e) => !e.archived)
    .sort(
      (a, b) =>
        Number(!!b.is_primary) - Number(!!a.is_primary) ||
        (a.priority ?? 0) - (b.priority ?? 0),
    );

  const total = flags.length * (1 + liveEnvironments.length);
  let done = 0;
  const tick = <T>(value: T) => {
    onProgress(++done, total);
    return value;
  };
  const detailed = await Promise.all(
    flags.map(async (flag) => {
      const base = `/projects/${projectId}/flags/${encodeURIComponent(flag.key)}`;
      const [variations, rulesets] = await Promise.all([
        getAllFlagsApi<OptimizelyVariation>(`${base}/variations`).then(tick),
        Promise.all(
          liveEnvironments.map((env) =>
            getFlagsApi<OptimizelyRuleset>(
              `${base}/environments/${encodeURIComponent(env.key)}/ruleset`,
            )
              .then(tick)
              .then((ruleset) => [env.key, ruleset] as const),
          ),
        ),
      ]);
      return { ...flag, variations, rulesets: Object.fromEntries(rulesets) };
    }),
  );

  return {
    project,
    environments: liveEnvironments,
    audiences: audiences.filter((a) => !a.archived),
    events,
    flags: detailed,
  };
}

type Condition = Record<string, unknown>;

type ConditionLeaf = {
  type?: string;
  name?: string;
  match_type?: string;
  // The SDK datafile's spelling of match_type
  match?: string;
  value?: unknown;
  audience_id?: number | string;
};

type TreeOperator = "and" | "or" | "not";

// Optimizely's condition trees: ["and" | "or" | "not", ...children] with
// objects as leaves. A list with no operator is an "or".
function walkTree<T>(
  node: unknown,
  leaf: (leaf: ConditionLeaf) => T,
  combine: (operator: TreeOperator, children: T[]) => T,
): T {
  if (Array.isArray(node)) {
    const hasOperator = ["and", "or", "not"].includes(node[0]);
    return combine(
      hasOperator ? node[0] : "or",
      (hasOperator ? node.slice(1) : node).map((child) =>
        walkTree(child, leaf, combine),
      ),
    );
  }
  if (node && typeof node === "object") return leaf(node);
  throw new Error("Unrecognized audience condition");
}

function conditionAttributes(condition: unknown): string[] {
  if (Array.isArray(condition)) return condition.flatMap(conditionAttributes);
  if (!condition || typeof condition !== "object") return [];
  return Object.entries(condition).flatMap(([key, value]) =>
    key.startsWith("$") ? conditionAttributes(value) : [key],
  );
}

function combineConditions(
  operator: TreeOperator,
  children: Condition[],
): Condition {
  const isEmpty = (c: Condition) => !Object.keys(c).length;
  if (operator === "not") {
    if (children.length !== 1 || isEmpty(children[0])) {
      throw new Error('A "not" condition needs exactly one condition');
    }
    // Optimizely doesn't match a "not" when the attribute is missing.
    // ponytail: this requires every attribute under the "not", which is
    // stricter than Optimizely for a "not" around an "and" that is already
    // false. Model three-valued logic if someone hits it.
    const attributes = [...new Set(conditionAttributes(children[0]))];
    return {
      $and: [
        ...attributes.map((a) => ({ [a]: { $exists: true } })),
        { $not: children[0] },
      ],
    };
  }
  if (operator === "or" && children.some(isEmpty)) return {};
  const conditions = children.filter((c) => !isEmpty(c));
  if (!conditions.length) return {};
  if (conditions.length === 1) return conditions[0];
  if (operator === "or") return { $or: conditions };
  const merged = Object.assign({}, ...conditions);
  const keys = conditions.reduce((n, c) => n + Object.keys(c).length, 0);
  return Object.keys(merged).length === keys ? merged : { $and: conditions };
}

const MATCH_OPERATORS: Record<string, string> = {
  gt: "$gt",
  ge: "$gte",
  lt: "$lt",
  le: "$lte",
  semver_eq: "$veq",
  semver_gt: "$vgt",
  semver_ge: "$vgte",
  semver_lt: "$vlt",
  semver_le: "$vlte",
};

const leafMatch = (leaf: ConditionLeaf) =>
  leaf.match_type ??
  leaf.match ??
  ((leaf.value ?? null) !== null ? "exact" : "exists");

function leafToCondition(leaf: ConditionLeaf): Condition {
  if (leaf.type !== "custom_attribute" || !leaf.name) {
    throw new Error(
      `Unsupported audience condition type: ${leaf.type ?? "unknown"}`,
    );
  }
  const match = leafMatch(leaf);
  if (match === "exact") return { [leaf.name]: leaf.value };
  if (match === "exists") return { [leaf.name]: { $exists: true } };
  if (match === "substring") {
    return { [leaf.name]: { $regex: escapeRegExp(String(leaf.value)) } };
  }
  const operator = MATCH_OPERATORS[match];
  if (!operator) throw new Error(`Unsupported audience match type: ${match}`);
  return { [leaf.name]: { [operator]: leaf.value } };
}

function parseAudience(audience: OptimizelyAudience): unknown {
  try {
    return JSON.parse(audience.conditions);
  } catch {
    throw new Error("Audience conditions aren't valid JSON");
  }
}

export function audienceToCondition(audience: OptimizelyAudience): Condition {
  const condition = walkTree(
    parseAudience(audience),
    leafToCondition,
    combineConditions,
  );
  if (!Object.keys(condition).length) {
    throw new Error("Audience has no conditions");
  }
  return condition;
}

// Attribute name -> operator hints for creating missing attributes
function audienceAttributes(audience: OptimizelyAudience): [string, string][] {
  try {
    return walkTree<[string, string][]>(
      parseAudience(audience),
      (leaf) =>
        leaf.name
          ? [
              [
                leaf.name,
                leafMatch(leaf).startsWith("semver") ? "version_gt" : "",
              ],
            ]
          : [],
      (_, children) => children.flat(),
    );
  } catch {
    return [];
  }
}

const SAVED_GROUP_DESCRIPTION_LENGTH = 100;

export function transformAudience(
  audience: OptimizelyAudience,
  project: string,
) {
  return {
    groupName: audience.name,
    type: "condition" as const,
    condition: JSON.stringify(audienceToCondition(audience)),
    description: (audience.description || "").slice(
      0,
      SAVED_GROUP_DESCRIPTION_LENGTH,
    ),
    projects: project ? [project] : [],
  };
}

// Where the single events table keeps what Optimizely metrics read. A column
// left blank only blocks the metrics that need it.
export type EventsFactTable = {
  id: string;
  eventNameColumn: string;
  revenueColumn: string;
  valueColumn: string;
  // By the name of each event property a metric filters on
  propertyColumns: Record<string, string>;
};

export type TransformContext = {
  opt: OptimizelyData;
  project: string;
  datasource: DataSourceInterfaceWithParams | null;
  // The single table every imported metric reads from, filtered by event name
  eventsFactTable: EventsFactTable | null;
  environmentIds: Set<string>;
  // By Optimizely audience id
  savedGroupIds: Map<string, string>;
  // By metricKey
  metricIds: Map<string, string>;
};

type Targeting = Omit<PhaseTargeting, "coverage">;
type SavedGroupTargeting = Targeting["savedGroups"];

function ruleAudienceIds(rule: OptimizelyRule): string[] {
  const conditions = rule.audience_conditions;
  if (!Array.isArray(conditions)) return [];
  try {
    return walkTree<string[]>(
      conditions,
      (leaf) =>
        leaf.audience_id !== undefined ? [String(leaf.audience_id)] : [],
      (_, children) => children.flat(),
    );
  } catch {
    return [];
  }
}

export function getRuleTargeting(
  rule: OptimizelyRule,
  ctx: TransformContext,
): Targeting {
  const conditions = rule.audience_conditions;
  if (!Array.isArray(conditions) || !conditions.length) {
    return { condition: "", savedGroups: [] };
  }

  // Saved Group targeting is a list of all/any checks that all must pass,
  // which covers the trees Optimizely's UI builds
  const groups = walkTree<SavedGroupTargeting | null>(
    conditions,
    (leaf) => {
      const id = ctx.savedGroupIds.get(String(leaf.audience_id));
      return id ? [{ match: "any", ids: [id] }] : null;
    },
    (operator, children) => {
      const known = children.flatMap((c) => (c ? [c] : []));
      if (known.length < children.length) return null;
      if (operator === "and") return known.flat();
      // Excluding a Saved Group would also match users missing its
      // attributes, which Optimizely doesn't. The copied conditions guard that.
      if (operator === "not") return null;
      const single = known.every(
        (c) =>
          c.length === 1 &&
          (c[0].match === "any" ||
            (c[0].match === "all" && c[0].ids.length === 1)),
      );
      if (!single) return null;
      return [
        {
          match: "any",
          ids: known.flatMap((c) => c[0].ids),
        },
      ];
    },
  );
  if (groups) return { condition: "", savedGroups: groups };

  // Otherwise copy the audiences' own conditions into the rule
  const condition = walkTree(
    conditions,
    (leaf) => {
      const audience = ctx.opt.audiences.find(
        (a) => String(a.id) === String(leaf.audience_id),
      );
      if (!audience) throw new Error(`Unknown audience ${leaf.audience_id}`);
      return audienceToCondition(audience);
    },
    combineConditions,
  );
  return {
    condition: Object.keys(condition).length ? JSON.stringify(condition) : "",
    savedGroups: [],
  };
}

function liveRules(ruleset: OptimizelyRuleset): OptimizelyRule[] {
  const rules = ruleset.rules ?? {};
  const keys = ruleset.rule_priorities?.length
    ? ruleset.rule_priorities
    : Object.keys(rules);
  return keys.flatMap((key) =>
    rules[key] && !rules[key].archived && rules[key].status !== "concluded"
      ? [rules[key]]
      : [],
  );
}

const isExperimentRule = (rule: OptimizelyRule) => rule.type === "a/b";

const coverage = (rule: OptimizelyRule) =>
  Math.min(1, Math.max(0, (rule.percentage_included ?? 10000) / 10000));

// Experiments aren't imported: they finish in Optimizely and new ones start in
// GrowthBook. Their metric definitions still come over.
function experimentRules(opt: OptimizelyData): OptimizelyRule[] {
  return opt.flags.flatMap((flag) =>
    Object.values(flag.rulesets).flatMap((ruleset) =>
      liveRules(ruleset).filter(isExperimentRule),
    ),
  );
}

const subMetricKey = (m: OptimizelySubMetric) =>
  [
    m.aggregator,
    m.event_id ?? "",
    m.field ?? "",
    m.scope ?? "",
    m.role ?? "",
    m.event_properties?.filter ? JSON.stringify(m.event_properties.filter) : "",
  ].join("|");

// Optimizely defines metrics on each rule, so the same definition on two
// experiments is one Fact Metric
export const metricKey = (m: OptimizelyMetric) =>
  [
    subMetricKey(m),
    m.winning_direction ?? "",
    ...(m.metrics ?? []).map(subMetricKey),
  ].join("~");

// Run artifacts cap external ids at 200 characters, and a key with property
// filters can be longer
export const metricExternalId = (m: OptimizelyMetric) => md5(metricKey(m));

export function getMetrics(opt: OptimizelyData): OptimizelyMetric[] {
  const metrics = new Map<string, OptimizelyMetric>();
  experimentRules(opt).forEach((rule) =>
    (rule.metrics ?? []).forEach((m) => {
      if (!metrics.has(metricKey(m))) metrics.set(metricKey(m), m);
    }),
  );
  return [...metrics.values()];
}

// Event properties the metrics filter on, each needing a column
export function getFilterProperties(opt: OptimizelyData): string[] {
  return [
    ...new Set(
      getMetrics(opt)
        .flatMap((m) => [m, ...(m.metrics ?? [])])
        .flatMap((m) => m.event_properties?.filter?.conditions ?? [])
        .map((c) => c.name),
    ),
  ];
}

const AGGREGATOR_LABELS: Record<string, string> = {
  unique: "unique conversions",
  count: "total conversions",
};

function subMetricName(m: OptimizelySubMetric, opt: OptimizelyData): string {
  const event = opt.events.find((e) => e.id === m.event_id);
  const what =
    m.aggregator === "sum"
      ? `total ${m.field}`
      : (AGGREGATOR_LABELS[m.aggregator] ?? m.aggregator);
  return `${event?.name || event?.key || "All events"}: ${what}${
    m.scope === "event" ? " per conversion" : ""
  }`;
}

export function metricName(m: OptimizelyMetric, opt: OptimizelyData): string {
  if (m.display_title) return m.display_title;
  if (m.aggregator !== "ratio") return subMetricName(m, opt);
  const { numerator, denominator } = ratioParts(m);
  return `${subMetricName(numerator, opt)} / ${subMetricName(denominator, opt)}`;
}

function ratioParts(m: OptimizelyMetric) {
  const subs = m.metrics ?? [];
  // The Flags API labels each part; without labels the numerator comes first
  const numerator = subs.find((s) => s.role === "numerator") ?? subs[0];
  const denominator =
    subs.find((s) => s.role === "denominator") ??
    subs.find((s) => s !== numerator);
  if (!numerator || !denominator) {
    throw new Error("Ratio metric needs a numerator and a denominator");
  }
  return { numerator, denominator };
}

const PROPERTY_OPERATORS: Record<
  string,
  NonNullable<ColumnRef["rowFilters"]>[number]["operator"]
> = {
  equal_to: "=",
  not_equal_to: "!=",
  greater_than: ">",
  greater_than_or_equal_to: ">=",
  less_than: "<",
  less_than_or_equal_to: "<=",
  contains: "contains",
  does_not_contain: "not_contains",
};

function toColumnRef(
  m: OptimizelySubMetric,
  column: string,
  ctx: TransformContext,
): ColumnRef {
  const factTable = ctx.eventsFactTable;
  if (!ctx.datasource || !factTable) {
    throw new Error("Select a Data Source and an events Fact Table");
  }
  const rowFilters: NonNullable<ColumnRef["rowFilters"]> = [];
  // No event means every event, e.g. overall revenue
  if ((m.event_id ?? null) !== null) {
    const event = ctx.opt.events.find((e) => e.id === m.event_id);
    if (!event) throw new Error(`Unknown event ${m.event_id}`);
    if (!factTable.eventNameColumn) {
      throw new Error("Choose an event name column to import this");
    }
    rowFilters.push({
      column: factTable.eventNameColumn,
      operator: "in",
      values: [event.key],
    });
  }
  const filter = m.event_properties?.filter;
  const conditions = filter?.conditions ?? [];
  if (conditions.length > 1 && filter?.combine_operator === "or") {
    throw new Error(
      'Event property filters combined with "or" aren\'t supported',
    );
  }
  conditions.forEach((c) => {
    const operator = PROPERTY_OPERATORS[c.operator];
    if (!operator) {
      throw new Error(`Unsupported event property filter: ${c.operator}`);
    }
    const propertyColumn = factTable.propertyColumns[c.name];
    if (!propertyColumn) {
      throw new Error(
        `Choose a column for the "${c.name}" property to import this`,
      );
    }
    rowFilters.push({
      column: propertyColumn,
      operator,
      values: [String(c.value)],
    });
  });
  return { factTableId: factTable.id, column, aggregation: "sum", rowFilters };
}

function subMetricColumn(
  m: OptimizelySubMetric,
  ctx: TransformContext,
): string {
  switch (m.aggregator) {
    case "unique":
      return "$$distinctUsers";
    case "count":
      return "$$count";
    case "sum": {
      if (m.field !== "revenue" && m.field !== "value") {
        throw new Error(`Unsupported metric field: ${m.field}`);
      }
      const column = ctx.eventsFactTable?.[`${m.field}Column`];
      // With no Fact Table at all, toColumnRef gives the clearer error
      if (ctx.eventsFactTable && !column) {
        throw new Error(`Choose a ${m.field} column to import this`);
      }
      return column ?? "";
    }
    default:
      throw new Error(`Unsupported metric aggregation: ${m.aggregator}`);
  }
}

type MetricDefinition = Pick<
  FactMetricPayload,
  "metricType" | "numerator" | "denominator"
>;

function getMetricDefinition(
  m: OptimizelyMetric,
  ctx: TransformContext,
): MetricDefinition {
  if (m.aggregator === "ratio") {
    const { numerator, denominator } = ratioParts(m);
    return {
      metricType: "ratio",
      numerator: toColumnRef(numerator, subMetricColumn(numerator, ctx), ctx),
      denominator: toColumnRef(
        denominator,
        subMetricColumn(denominator, ctx),
        ctx,
      ),
    };
  }
  if (m.scope === "session") {
    throw new Error("Per-session metrics aren't supported");
  }
  const numerator = toColumnRef(m, subMetricColumn(m, ctx), ctx);
  // Per conversion: the total divided by the number of events
  if (m.scope === "event") {
    if (m.aggregator !== "sum") {
      throw new Error(`Unsupported per-event aggregation: ${m.aggregator}`);
    }
    return {
      metricType: "ratio",
      numerator,
      denominator: toColumnRef(m, "$$count", ctx),
    };
  }
  return {
    metricType: m.aggregator === "unique" ? "proportion" : "mean",
    numerator,
    denominator: null,
  };
}

const usesRevenue = (m: OptimizelyMetric) =>
  [m, ...(m.metrics ?? [])].some((s) => s.field === "revenue");

export function transformMetric(
  m: OptimizelyMetric,
  ctx: TransformContext,
): FactMetricPayload {
  const definition = getMetricDefinition(m, ctx);
  return {
    name: metricName(m, ctx.opt),
    description: usesRevenue(m)
      ? "Imported from Optimizely, where revenue is tracked in cents."
      : "",
    datasource: ctx.datasource?.id ?? "",
    projects: ctx.project ? [ctx.project] : [],
    tags: [],
    archived: false,
    ...definition,
    quantileSettings: null,
    funnelSettings: null,
    compoundSettings: null,
    cappingSettings: { type: "", value: 0 },
    lowerCappingSettings: { type: "", value: 0 },
    windowSettings: {
      type: "",
      delayValue: 0,
      delayUnit: "days",
      windowValue: 0,
      windowUnit: "days",
    },
    priorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: DEFAULT_PROPER_PRIOR_STDDEV,
    },
    inverse: m.winning_direction === "decreasing",
    maxPercentChange: DEFAULT_MAX_PERCENT_CHANGE,
    minPercentChange: DEFAULT_MIN_PERCENT_CHANGE,
    minSampleSize: DEFAULT_MIN_SAMPLE_SIZE,
    targetMDE: DEFAULT_TARGET_MDE,
    displayAsPercentage: false,
    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 0,
  };
}

function parseVariable(type: string, value: string): unknown {
  switch (type) {
    case "boolean":
      return value === "true";
    case "integer":
    case "double":
      return Number(value);
    case "json":
      try {
        return JSON.parse(value);
      } catch {
        return value;
      }
    default:
      return value;
  }
}

// A flag with no variables is a boolean. A flag with variables becomes JSON
// shaped like the SDK's decision: { enabled, variables }.
function variationValue(
  flag: OptimizelyFlag,
  variation: OptimizelyVariation,
): string {
  const definitions = Object.values(flag.variable_definitions ?? {});
  if (!definitions.length) return String(!!variation.enabled);
  return JSON.stringify({
    enabled: !!variation.enabled,
    variables: Object.fromEntries(
      definitions.map((d) => [
        d.key,
        parseVariable(
          d.type,
          variation.variables?.[d.key]?.value ?? d.default_value ?? "",
        ),
      ]),
    ),
  });
}

export function transformFlag(
  flag: OptimizelyFlag,
  ctx: TransformContext,
): FeaturePayload {
  const valueType: FeatureValueType = Object.keys(
    flag.variable_definitions ?? {},
  ).length
    ? "json"
    : "boolean";
  const variations = new Map(flag.variations.map((v) => [v.key, v]));
  const value = (key: string) => {
    const variation = variations.get(key);
    if (!variation) throw new Error(`Unknown variation "${key}"`);
    return variationValue(flag, variation);
  };

  const envs = ctx.opt.environments
    .map((e) => ({ id: toEnvironmentId(e.key), ruleset: flag.rulesets[e.key] }))
    .filter((e) => e.ruleset && ctx.environmentIds.has(e.id));
  const envDefault = (ruleset: OptimizelyRuleset) =>
    value(ruleset.default_variation_key ?? "off");
  const defaultValue = envs.length
    ? envDefault(envs[0].ruleset)
    : variations.has("off")
      ? value("off")
      : valueType === "boolean"
        ? "false"
        : "{}";

  const environmentSettings: FeaturePayload["environmentSettings"] = {};
  const rules: FeatureRule[] = [];
  envs.forEach(({ id: envId, ruleset }) => {
    environmentSettings[envId] = { enabled: !!ruleset.enabled };
    const envBase = { allEnvironments: false, environments: [envId] };
    // A/B rules are left out, so their users get the rules below them
    const envRules = liveRules(ruleset).filter((r) => !isExperimentRule(r));
    envRules.forEach((rule, i) => {
      const id = `fr_opt_${rule.id ?? `${envId}_${rule.key}`}`;
      const base = { ...envBase, description: rule.name || rule.key };
      const serving =
        rule.enabled !== false && (!rule.status || rule.status === "running");

      // Users pinned to a variation
      const pinned = new Map<string, string[]>();
      Object.values(rule.allow_list ?? {}).forEach((entry) => {
        const key = entry.variation?.key;
        if (!entry.user_id || !key) return;
        pinned.set(key, [...(pinned.get(key) ?? []), entry.user_id]);
      });
      pinned.forEach((userIds, key) =>
        rules.push({
          ...base,
          id: `${id}_allow_${key}`,
          description: `${base.description}: allow list`,
          enabled: serving,
          type: "force",
          value: value(key),
          condition: JSON.stringify({ id: { $in: userIds } }),
          savedGroups: [],
        }),
      );

      const targeting = getRuleTargeting(rule, ctx);

      if (
        rule.type !== "targeted_delivery" &&
        rule.type !== "feature_rollout"
      ) {
        throw new Error(
          `${rule.type === "multi_armed_bandit" ? "Bandit" : rule.type} rules aren't supported`,
        );
      }
      const served = Object.values(rule.variations ?? {});
      if (served.length !== 1) {
        throw new Error(`Rule "${rule.key}" doesn't deliver one variation`);
      }
      const delivered = { ...base, ...targeting, id, enabled: serving };
      const ruleValue = value(served[0].key);
      if (coverage(rule) === 1) {
        rules.push({ ...delivered, type: "force", value: ruleValue });
        return;
      }
      rules.push({
        ...delivered,
        type: "rollout",
        value: ruleValue,
        coverage: coverage(rule),
        hashAttribute: "id",
      });
      // Optimizely sends users in the audience but outside the rollout to the
      // default variation, skipping the rules below
      if (i < envRules.length - 1) {
        rules.push({
          ...delivered,
          id: `${id}_rest`,
          description: `${base.description}: outside the rollout`,
          type: "force",
          value: envDefault(ruleset),
        });
      }
    });
    if (envDefault(ruleset) !== defaultValue) {
      rules.push({
        ...envBase,
        id: `fr_opt_default_${envId}`,
        description: "Default variation",
        enabled: true,
        type: "force",
        value: envDefault(ruleset),
        condition: "",
        savedGroups: [],
      });
    }
  });

  return {
    id: flag.key,
    description:
      flag.description || (flag.name !== flag.key ? flag.name : "") || "",
    project: ctx.project,
    tags: [],
    valueType,
    defaultValue,
    environmentSettings,
    rules,
  };
}

export type ImportItem<T> = {
  key: string;
  name: string;
  source: T;
  // Optimizely's id, recorded on the run so the next import finds this item
  externalId: string;
  existingId?: string;
  match?: "run" | "name";
  status: "pending" | "invalid" | "completed" | "failed";
  error?: string;
  preview?: unknown;
};

export type OptimizelyImportData = {
  environments: ImportItem<OptimizelyEnvironment>[];
  audiences: ImportItem<OptimizelyAudience>[];
  metrics: ImportItem<OptimizelyMetric>[];
  flags: ImportItem<OptimizelyFlag>[];
};

export type OptimizelyCategory = keyof OptimizelyImportData;

export const CATEGORIES: { key: OptimizelyCategory; label: string }[] = [
  { key: "environments", label: "Environments" },
  { key: "audiences", label: "Audiences → Saved Groups" },
  { key: "metrics", label: "Metrics → Fact Metrics" },
  { key: "flags", label: "Flags → Feature Flags" },
];

const ARTIFACT_KINDS: Record<OptimizelyCategory, AutoRunArtifact["kind"]> = {
  environments: "environment",
  audiences: "saved-group",
  metrics: "metric",
  flags: "feature",
};

export const OPTIMIZELY_RUN_SOURCE = "optimizely-import";
const RECORD_CHUNK = 200;

type MatchedCategory = Exclude<OptimizelyCategory, "environments">;

// Optimizely id -> GrowthBook id, from earlier import runs
export type ImportedIds = Record<MatchedCategory, Map<string, string>>;

export function getImportedIds(
  runs: ApiAutoRun[],
  exists: (kind: AutoRunArtifact["kind"], id: string) => boolean,
): ImportedIds {
  const ids: ImportedIds = {
    audiences: new Map(),
    metrics: new Map(),
    flags: new Map(),
  };
  runs
    .filter((r) => r.source === OPTIMIZELY_RUN_SOURCE)
    .sort((a, b) => a.dateCreated.localeCompare(b.dateCreated))
    .forEach((run) =>
      run.artifacts.forEach((a) => {
        const external = a.externalId ?? "";
        const category = external.slice(0, external.indexOf(":"));
        const id = external.slice(category.length + 1);
        if (!(category in ids) || !id || a.action === "failed") return;
        const imported = ids[category as MatchedCategory];
        if (a.action === "deleted" || !exists(a.kind, a.id)) {
          imported.delete(id);
        } else {
          imported.set(id, a.id);
        }
      }),
    );
  return ids;
}

export type ExistingIds = {
  environments: Set<string>;
  imported: ImportedIds;
  // Name or key -> id
  savedGroups: Map<string, string>;
  factMetrics: Map<string, string>;
  features: Set<string>;
};

export type Matches = Record<OptimizelyCategory, Map<string, ItemMatch>>;

export function matchItems(
  opt: OptimizelyData,
  existing: ExistingIds,
): Matches {
  const match = (
    category: MatchedCategory,
    id: string,
    byName: string | undefined,
  ): ItemMatch => {
    const imported = existing.imported[category].get(id);
    if (imported) return { existingId: imported, match: "run" };
    return byName ? { existingId: byName, match: "name" } : {};
  };
  return {
    environments: new Map(
      opt.environments.map((e) => {
        const id = toEnvironmentId(e.key);
        return [
          id,
          existing.environments.has(id) ? { existingId: id, match: "run" } : {},
        ];
      }),
    ),
    audiences: new Map(
      opt.audiences.map((a) => [
        String(a.id),
        match("audiences", String(a.id), existing.savedGroups.get(a.name)),
      ]),
    ),
    metrics: new Map(
      getMetrics(opt).map((m) => [
        metricKey(m),
        match(
          "metrics",
          metricExternalId(m),
          existing.factMetrics.get(metricName(m, opt)),
        ),
      ]),
    ),
    flags: new Map(
      opt.flags.map((f) => [
        f.key,
        match(
          "flags",
          String(f.id),
          existing.features.has(f.key) ? f.key : undefined,
        ),
      ]),
    ),
  };
}

export type Selection = (category: OptimizelyCategory, key: string) => boolean;

export type ImportSettings = {
  project: string;
  datasource: DataSourceInterfaceWithParams | null;
  eventsFactTable: EventsFactTable | null;
};

function isValid(transform: () => unknown): boolean {
  try {
    transform();
    return true;
  } catch {
    return false;
  }
}

// `placeholder` stands in for the ids of selected items that don't exist yet,
// so a preview can show what will reference them
function getInitialContext(
  opt: OptimizelyData,
  existing: ExistingIds,
  matches: Matches,
  settings: ImportSettings,
  isSelected: Selection,
  placeholder?: string,
): TransformContext {
  const ctx: TransformContext = {
    opt,
    ...settings,
    environmentIds: new Set([
      ...existing.environments,
      ...opt.environments
        .map((e) => toEnvironmentId(e.key))
        .filter((id) => id && isSelected("environments", id)),
    ]),
    savedGroupIds: new Map(),
    metricIds: new Map(),
  };
  const idFor = (
    category: MatchedCategory,
    key: string,
    transform: () => unknown,
  ) =>
    matches[category].get(key)?.existingId ??
    (placeholder && isSelected(category, key) && isValid(transform)
      ? placeholder
      : undefined);

  opt.audiences.forEach((a) => {
    const id = idFor("audiences", String(a.id), () => audienceToCondition(a));
    if (id) ctx.savedGroupIds.set(String(a.id), id);
  });
  getMetrics(opt).forEach((m) => {
    const id = idFor("metrics", metricKey(m), () => transformMetric(m, ctx));
    if (id) ctx.metricIds.set(metricKey(m), id);
  });
  return ctx;
}

function buildItem<T>(
  key: string,
  name: string,
  source: T,
  externalId: string,
  match: ItemMatch | undefined,
  transform: () => unknown,
): ImportItem<T> {
  const item = { key, name, source, externalId, ...match };
  try {
    return { ...item, status: "pending", preview: transform() };
  } catch (e) {
    return { ...item, status: "invalid", error: e.message };
  }
}

export function buildImportData(
  opt: OptimizelyData,
  existing: ExistingIds,
  matches: Matches,
  settings: ImportSettings,
  isSelected: Selection,
): OptimizelyImportData {
  const ctx = getInitialContext(
    opt,
    existing,
    matches,
    settings,
    isSelected,
    "(new)",
  );
  return {
    environments: opt.environments.map((e) => {
      const id = toEnvironmentId(e.key);
      return buildItem(
        id,
        e.name,
        e,
        String(e.id),
        matches.environments.get(id),
        () => {
          if (!id) throw new Error("Environment key has no usable characters");
          return { id, description: e.name };
        },
      );
    }),
    audiences: opt.audiences.map((a) =>
      buildItem(
        String(a.id),
        a.name,
        a,
        String(a.id),
        matches.audiences.get(String(a.id)),
        () => transformAudience(a, settings.project),
      ),
    ),
    metrics: getMetrics(opt).map((m) =>
      buildItem(
        metricKey(m),
        metricName(m, opt),
        m,
        metricExternalId(m),
        matches.metrics.get(metricKey(m)),
        () => transformMetric(m, ctx),
      ),
    ),
    flags: opt.flags.map((f) =>
      buildItem(f.key, f.key, f, String(f.id), matches.flags.get(f.key), () =>
        transformFlag(f, ctx),
      ),
    ),
  };
}

export type OptimizelyImportOutcome = {
  runId: string;
  completed: number;
  failed: number;
};

export async function runOptimizelyImport({
  data,
  opt,
  isSelected,
  existing,
  settings,
  attributeSchema,
  apiCall,
  setItem,
}: {
  data: OptimizelyImportData;
  opt: OptimizelyData;
  isSelected: Selection;
  existing: ExistingIds;
  settings: ImportSettings;
  attributeSchema: SDKAttribute[];
  apiCall: ApiCall;
  setItem: (
    category: OptimizelyCategory,
    key: string,
    update: ImportResult,
  ) => void;
}): Promise<OptimizelyImportOutcome> {
  const { project, datasource } = settings;
  const ctx = getInitialContext(
    opt,
    existing,
    matchItems(opt, existing),
    settings,
    isSelected,
  );
  const PQueue = (await import("p-queue")).default;
  const parallel = new PQueue({ concurrency: 6 });

  const selected = <T>(category: OptimizelyCategory, items: ImportItem<T>[]) =>
    items.filter(
      (item) => item.status !== "invalid" && isSelected(category, item.key),
    );
  const existingEnvironments = data.environments.filter(
    (i) => i.existingId && i.status !== "invalid",
  );
  const selectedCount = CATEGORIES.reduce(
    (n, { key }) =>
      n +
      selected<unknown>(key, data[key]).filter(
        (i) => key !== "environments" || !i.existingId,
      ).length,
    0,
  );
  if (selectedCount + existingEnvironments.length > MAX_AUTO_RUN_ARTIFACTS) {
    throw new Error(
      `Select at most ${MAX_AUTO_RUN_ARTIFACTS} items per import so the run can record them all`,
    );
  }

  const metadata = {
    project,
    datasource: datasource?.id ?? "",
    selected: selectedCount,
  };
  const { autoRun } = await apiCall<{ autoRun: ApiAutoRun }>("/auto-runs", {
    method: "POST",
    body: JSON.stringify({ source: OPTIMIZELY_RUN_SOURCE, metadata }),
  });
  const runId = autoRun.id;
  const outcome: OptimizelyImportOutcome = { runId, completed: 0, failed: 0 };

  type Recorded = {
    item: ImportItem<unknown>;
    id: string;
    action: NonNullable<AutoRunArtifact["action"]>;
    error?: string;
  };
  let recorded: Recorded[] = [];
  const record = (item: ImportItem<unknown>, id: string) =>
    recorded.push({
      item,
      id,
      action: item.existingId ? "updated" : "created",
    });
  const flushRecorded = async (category: OptimizelyCategory) => {
    const batch = recorded;
    recorded = [];
    for (let i = 0; i < batch.length; i += RECORD_CHUNK) {
      const chunk = batch.slice(i, i + RECORD_CHUNK);
      try {
        await apiCall(`/auto-runs/${runId}/artifacts`, {
          method: "POST",
          body: JSON.stringify({
            artifacts: chunk.map(({ item, id, action, error }) => ({
              kind: ARTIFACT_KINDS[category],
              id,
              label: item.name.slice(0, 200),
              by: "growthbook",
              action,
              detail: (
                error ??
                {
                  created: "Created from Optimizely",
                  updated: "Updated from Optimizely",
                  existing: "Already in GrowthBook",
                  deleted: "",
                  failed: "",
                }[action]
              ).slice(0, 500),
              externalId: `${category}:${item.externalId}`,
            })),
          }),
        });
      } catch (e) {
        chunk.forEach(({ item, action }) => {
          if (action !== "created" && action !== "updated") return;
          outcome.completed--;
          outcome.failed++;
          setItem(category, item.key, {
            status: "failed",
            error: `Imported, but couldn't be recorded in the run report: ${e.message}`,
          });
        });
      }
    }
  };

  const importEach = async <T>(
    category: OptimizelyCategory,
    items: ImportItem<T>[],
    importItem: (item: ImportItem<T>) => Promise<unknown>,
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
          recorded.push({
            item,
            id: item.existingId ?? `${category}:${item.externalId}`,
            action: "failed",
            error: e.message,
          });
        }
      });
    });
    await queue.onIdle();
    await flushRecorded(category);
  };

  // A failed create leaves nothing for later items to reference
  const dropOnFailure = async <V>(
    refs: Map<string, V>,
    key: string,
    run: () => Promise<void>,
  ) => {
    try {
      await run();
    } catch (e) {
      refs.delete(key);
      throw e;
    }
  };
  const created = <T extends object>(payload: T) => ({ ...payload, owner: "" });

  try {
    // Attributes used by anything selected, directly or through a rule
    const audienceIds = new Set([
      ...selected("audiences", data.audiences).map((a) => a.key),
      ...selected("flags", data.flags).flatMap((f) =>
        Object.values(f.source.rulesets).flatMap((ruleset) =>
          liveRules(ruleset).flatMap(ruleAudienceIds),
        ),
      ),
    ]);
    const attributes = new Map<string, string[]>([["id", []]]);
    opt.audiences
      .filter((a) => audienceIds.has(String(a.id)))
      .flatMap(audienceAttributes)
      .forEach(([name, operator]) =>
        attributes.set(name, [...(attributes.get(name) ?? []), operator]),
      );
    for (const [name, operators] of attributes) {
      await ensureAttributeExists(name, attributeSchema, apiCall, operators);
    }

    existingEnvironments.forEach((item) =>
      recorded.push({ item, id: item.key, action: "existing" }),
    );
    const createdEnvs = new Set<string>();
    await importEach(
      "environments",
      data.environments.filter((i) => !i.existingId),
      async (item) => {
        await apiCall("/environment", {
          method: "PUT",
          body: JSON.stringify({
            environments: [{ id: item.key, description: item.source.name }],
          }),
        });
        createdEnvs.add(item.key);
        record(item, item.key);
      },
      { serial: true },
    );
    ctx.environmentIds = new Set([...existing.environments, ...createdEnvs]);

    await importEach("audiences", data.audiences, (item) =>
      dropOnFailure(ctx.savedGroupIds, item.key, async () => {
        const group = transformAudience(item.source, project);
        let id = item.existingId;
        if (id) {
          const res = await apiCall<{ requiresApproval?: boolean }>(
            `/saved-groups/${id}`,
            {
              method: "PUT",
              body: JSON.stringify(pick(group, ["groupName", "condition"])),
            },
          );
          if (res.requiresApproval) {
            throw new Error(
              "Saved Group changes need approval in this org. Approve the draft, then import again.",
            );
          }
        } else {
          const res = await apiCall<{ savedGroup: SavedGroupInterface }>(
            "/saved-groups",
            { method: "POST", body: JSON.stringify(created(group)) },
          );
          id = res.savedGroup.id;
        }
        ctx.savedGroupIds.set(item.key, id);
        record(item, id);
      }),
    );

    await importEach("metrics", data.metrics, (item) =>
      dropOnFailure(ctx.metricIds, item.key, async () => {
        const metric = transformMetric(item.source, ctx);
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
        ctx.metricIds.set(item.key, id);
        record(item, id);
      }),
    );

    await importEach("flags", data.flags, async (item) => {
      const flag = transformFlag(item.source, ctx);
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
          ...metadata,
          completed: outcome.completed,
          failed: outcome.failed,
        },
      }),
    }).catch(() => undefined);
  }

  return outcome;
}
