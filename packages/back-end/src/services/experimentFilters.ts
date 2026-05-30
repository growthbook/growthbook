import { ExperimentInterface } from "shared/types/experiment";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";
import { expandOrgMembers } from "back-end/src/services/organizations";
import { getExperimentsUsingMetric } from "back-end/src/models/ExperimentModel";

/**
 * Structured representation of the experiment filters supported by
 * ExperimentSearchFilters (front-end). Each category is ANDed together while
 * the values inside a category are ORed, mirroring the behavior of
 * useExperimentSearch's syntax filters.
 *
 * - `search` is the free-text remainder (matched against name / trackingKey /
 *   description / hypothesis).
 * - `types` tokens are normalized to "feature" | "visualChange" | "redirect".
 */
export type StructuredExperimentFilters = {
  projects?: string[];
  metrics?: string[];
  owners?: string[];
  results?: string[];
  statuses?: string[];
  tags?: string[];
  types?: string[];
  search?: string;
};

// Keys emitted by ExperimentSearchFilters that we know how to normalize.
const SEARCH_FILTER_KEYS = [
  "project",
  "metric",
  "owner",
  "is",
  "status",
  "tag",
  "has",
] as const;

// Normalize the various "has" tokens that useExperimentSearch recognizes down
// to the three experiment types ExperimentSearchFilters can set.
function normalizeTypeToken(token: string): string | undefined {
  const t = token.toLowerCase();
  if (t === "feature" || t === "features") return "feature";
  if (t === "visualchange" || t === "visualchanges") return "visualChange";
  if (t === "redirect" || t === "redirects") return "redirect";
  return undefined;
}

/**
 * Parse a raw ExperimentSearchFilters query string into structured filters.
 * Uses the same `field:[!][operator]value1,value2` syntax (with quoted values)
 * that the front-end parser in services/search.tsx produces. Only the filter
 * keys we understand are extracted; everything else is treated as free text.
 */
export function parseExperimentSearchString(
  searchString: string,
): StructuredExperimentFilters {
  if (!searchString || !searchString.trim()) return {};

  const regex = new RegExp(
    `(^|\\s)(${SEARCH_FILTER_KEYS.join(
      "|",
    )}):(\\!?)([><=~^]?)((?:"[^"]*"|[^\\s,]+)(?:,(?:"[^"]*"|[^\\s,]+))*)`,
    "gi",
  );

  const filters: StructuredExperimentFilters = {};
  const addValues = (
    key: keyof StructuredExperimentFilters,
    vals: string[],
  ) => {
    if (key === "search") return;
    const existing = (filters[key] as string[] | undefined) ?? [];
    filters[key] = [...existing, ...vals] as never;
  };

  const matches = searchString.matchAll(regex);
  for (const match of matches) {
    const field = (match[2] || "").toLowerCase();
    const negated = !!match[3];
    // Negated filters aren't expressible in ExperimentSearchFilters, so skip
    // them rather than guessing at exclusion semantics.
    if (negated) continue;
    const rawValue = match[5] || "";
    const values = (rawValue.match(/"[^"]*"|[^,]+/g) || []).map((s) =>
      s.trim().replace(/^"|"$/g, ""),
    );
    if (values.length === 0) continue;

    switch (field) {
      case "project":
        addValues("projects", values);
        break;
      case "metric":
        addValues("metrics", values);
        break;
      case "owner":
        addValues("owners", values);
        break;
      case "is":
        addValues("results", values);
        break;
      case "status":
        addValues("statuses", values);
        break;
      case "tag":
        addValues("tags", values);
        break;
      case "has":
        addValues(
          "types",
          values
            .map(normalizeTypeToken)
            .filter((v): v is string => v !== undefined),
        );
        break;
    }
  }

  const searchTerm = searchString
    .replace(regex, "$1")
    .trim()
    .replace(/\s+/g, " ");
  if (searchTerm) filters.search = searchTerm;

  return filters;
}

function mergeStringArrays(
  a: string[] | undefined,
  b: string[] | undefined,
): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])];
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}

/**
 * Normalize either a raw search string and/or explicit structured filters into
 * a single StructuredExperimentFilters object. When both are provided they are
 * merged (values deduplicated).
 */
export function normalizeExperimentFilters({
  searchString,
  filters,
}: {
  searchString?: string;
  filters?: StructuredExperimentFilters;
}): StructuredExperimentFilters {
  const parsed = searchString ? parseExperimentSearchString(searchString) : {};
  const types = mergeStringArrays(
    parsed.types,
    filters?.types
      ?.map(normalizeTypeToken)
      .filter((v): v is string => v !== undefined),
  );
  return {
    projects: mergeStringArrays(parsed.projects, filters?.projects),
    metrics: mergeStringArrays(parsed.metrics, filters?.metrics),
    owners: mergeStringArrays(parsed.owners, filters?.owners),
    results: mergeStringArrays(parsed.results, filters?.results),
    statuses: mergeStringArrays(parsed.statuses, filters?.statuses),
    tags: mergeStringArrays(parsed.tags, filters?.tags),
    types,
    search: filters?.search ?? parsed.search,
  };
}

// Resolvers map ids stored on experiments to the human-readable values the
// filter strings may contain (e.g. project/owner names). Built once per
// request and passed into the pure filter function.
export type ExperimentFilterResolvers = {
  // Candidate match strings (id, name, email, ...) for an owner id.
  ownerCandidates: Map<string, string[]>;
  // Map of project id -> project name.
  projectNameById: Map<string, string>;
};

function matchesCategory(
  values: string[] | undefined,
  candidates: (string | undefined)[],
): boolean {
  if (!values || values.length === 0) return true;
  const haystack = new Set(
    candidates.filter((c): c is string => !!c).map((c) => c.toLowerCase()),
  );
  return values.some((v) => haystack.has(v.toLowerCase()));
}

function experimentHasType(
  experiment: ExperimentInterface,
  type: string,
): boolean {
  switch (type) {
    case "feature":
      return !!experiment.linkedFeatures?.length;
    case "visualChange":
      return !!experiment.hasVisualChangesets;
    case "redirect":
      return !!experiment.hasURLRedirects;
    default:
      return false;
  }
}

/**
 * Filter a list of experiments by the normalized structured filters, plus the
 * bandit and phase-end date-range constraints used by the metric experiments
 * views. Pure given the resolver maps; safe to unit test.
 */
export function filterExperiments({
  experiments,
  filters,
  resolvers,
  bandits,
  startDate,
  endDate,
}: {
  experiments: ExperimentInterface[];
  filters: StructuredExperimentFilters;
  resolvers: ExperimentFilterResolvers;
  bandits?: boolean;
  startDate?: Date;
  endDate?: Date;
}): ExperimentInterface[] {
  const searchTerm = filters.search?.toLowerCase();

  return experiments.filter((e) => {
    // Bandit scoping: only applied when an explicit preference is provided so
    // existing callers that omit it keep receiving all experiment types.
    if (bandits === true && e.type !== "multi-armed-bandit") return false;
    if (bandits === false && e.type === "multi-armed-bandit") return false;

    // Project (match by id or resolved name)
    if (
      !matchesCategory(filters.projects, [
        e.project,
        e.project ? resolvers.projectNameById.get(e.project) : undefined,
      ])
    ) {
      return false;
    }

    // Owner (match by id or resolved name/email candidates)
    if (
      !matchesCategory(filters.owners, [
        e.owner,
        ...(e.owner ? (resolvers.ownerCandidates.get(e.owner) ?? []) : []),
      ])
    ) {
      return false;
    }

    // Result (only stopped experiments carry a result)
    if (!matchesCategory(filters.results, [e.results])) return false;

    // Status
    if (!matchesCategory(filters.statuses, [e.status])) return false;

    // Tags (OR across requested tags)
    if (filters.tags && filters.tags.length > 0) {
      if (!matchesCategory(filters.tags, e.tags ?? [])) return false;
    }

    // Metric (the route is already metric-scoped; this further restricts by
    // the experiment's own metric ids if a metric id was passed)
    if (filters.metrics && filters.metrics.length > 0) {
      const expMetricIds = [
        ...(e.goalMetrics ?? []),
        ...(e.secondaryMetrics ?? []),
        ...(e.guardrailMetrics ?? []),
      ];
      if (!matchesCategory(filters.metrics, expMetricIds)) return false;
    }

    // Type / has (OR across requested types)
    if (filters.types && filters.types.length > 0) {
      if (!filters.types.some((t) => experimentHasType(e, t))) return false;
    }

    // Free-text search (approximation of useExperimentSearch's fuzzy match
    // over name / trackingKey / description / hypothesis)
    if (searchTerm) {
      const text = [e.name, e.trackingKey, e.description, e.hypothesis]
        .filter((s): s is string => !!s)
        .join(" ")
        .toLowerCase();
      if (!text.includes(searchTerm)) {
        return false;
      }
    }

    // Phase-end date-range constraint (matches getMetricExperimentResults)
    if (startDate || endDate) {
      const start = startDate ?? new Date(0);
      const end = endDate ?? new Date();
      const inRange = e.phases.some((p) => {
        if (!p.dateEnded) return false;
        const ended = new Date(p.dateEnded);
        return ended >= start && ended <= end;
      });
      if (!inRange) return false;
    }

    return true;
  });
}

/**
 * Build the resolver maps needed by filterExperiments for the current org.
 */
export async function buildExperimentFilterResolvers(
  context: ReqContext | ApiReqContext,
): Promise<ExperimentFilterResolvers> {
  const projectNameById = new Map<string, string>();
  const projects = await context.models.projects.getAll();
  projects.forEach((p) => projectNameById.set(p.id, p.name));

  const ownerCandidates = new Map<string, string[]>();
  const expandedMembers = await expandOrgMembers(context.org.members);
  expandedMembers.forEach((m) => {
    const candidates = [m.name, m.email].filter(
      (s): s is string => !!s && s.length > 0,
    );
    ownerCandidates.set(m.id, candidates);
  });

  return { ownerCandidates, projectNameById };
}

/**
 * Fetch the experiments that use a metric and apply the normalized filters.
 * Shared by the internal metric-experiments controller and the public REST
 * endpoint so both go through identical normalization + filtering.
 */
export async function getFilteredExperimentsUsingMetric({
  context,
  metricId,
  searchString,
  filters,
  bandits,
  startDate,
  endDate,
  limit = 500,
}: {
  context: ReqContext | ApiReqContext;
  metricId: string;
  searchString?: string;
  filters?: StructuredExperimentFilters;
  bandits?: boolean;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
}): Promise<ExperimentInterface[]> {
  const experiments = await getExperimentsUsingMetric({
    context,
    metricId,
    limit,
  });

  const normalized = normalizeExperimentFilters({ searchString, filters });
  const resolvers = await buildExperimentFilterResolvers(context);

  return filterExperiments({
    experiments,
    filters: normalized,
    resolvers,
    bandits,
    startDate,
    endDate,
  });
}
