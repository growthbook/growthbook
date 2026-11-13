import {
  ExperimentQaOverrideAssignment,
  ExperimentQaOverrideInterface,
  QaOverrideFilters,
} from "shared/types/experiment-qa-override";
import { SavedGroupTargeting } from "shared/validators";
import { qaOverrideHasCondition, sortQaOverrides } from "shared/util";
import { jsonToConds } from "@/services/features";

// Pure helpers behind the QA overrides UI: grouping rows by environment,
// summarizing filters into words, and the add/edit form's shape. Kept free
// of React so they can be unit-tested directly.

// ---------------------------------------------------------------------------
// Grouping

export type QaOverrideGroup<T> = {
  environment: string;
  // `priority` restarts at 1 inside each environment: first match wins there.
  rows: { item: T; priority: number }[];
};

/**
 * Overrides grouped by environment, in the org's environment order, each
 * group sorted by `order`. Environments the org no longer lists go last.
 */
export function groupQaOverrides<
  T extends Pick<
    ExperimentQaOverrideInterface,
    "environment" | "order" | "dateCreated"
  >,
>(overrides: T[], environmentOrder: string[]): QaOverrideGroup<T>[] {
  const byEnv = new Map<string, T[]>();
  for (const o of sortQaOverrides(overrides)) {
    byEnv.set(o.environment, [...(byEnv.get(o.environment) ?? []), o]);
  }
  const known = environmentOrder.filter((e) => byEnv.has(e));
  const unknown = [...byEnv.keys()]
    .filter((e) => !environmentOrder.includes(e))
    .sort();
  return [...known, ...unknown].map((environment) => ({
    environment,
    rows: (byEnv.get(environment) ?? []).map((item, i) => ({
      item,
      priority: i + 1,
    })),
  }));
}

/** The grouped layout (environment header rows) is for when order matters. */
export function qaOverridesNeedGrouping<T>(
  groups: QaOverrideGroup<T>[],
): boolean {
  return groups.some((g) => g.rows.length > 1);
}

// ---------------------------------------------------------------------------
// Filters

export type QaOverrideFilterKind = keyof QaOverrideFilters;

export const QA_OVERRIDE_FILTER_KINDS: QaOverrideFilterKind[] = [
  "condition",
  "savedGroups",
  "sdkConnections",
  "projects",
];

export type QaOverrideNameLookups = {
  savedGroupName: (id: string) => string;
  sdkConnectionName: (id: string) => string;
  projectName: (id: string) => string;
  operatorText: (operator: string) => string;
};

// ---------------------------------------------------------------------------
// "Who sees it" summary

// One piece of the summary per filter type that has something in it, e.g.
// `id = 123`, `QA team, Beta testers`, `Local dev (React)`.
export type QaOverrideAudienceSegment = {
  kind: QaOverrideFilterKind;
  text: string;
  // An attribute condition too involved to put into words.
  custom?: boolean;
};

// Lists longer than this show the first few and a count.
export const QA_OVERRIDE_SUMMARY_MAX_VALUES = 3;

function listValues(names: string[]): string {
  if (names.length <= QA_OVERRIDE_SUMMARY_MAX_VALUES) return names.join(", ");
  const shown = names.slice(0, QA_OVERRIDE_SUMMARY_MAX_VALUES).join(", ");
  return `${shown} +${names.length - QA_OVERRIDE_SUMMARY_MAX_VALUES} more`;
}

const NO_VALUE_OPERATORS = new Set([
  "$exists",
  "$notExists",
  "$empty",
  "$notEmpty",
]);
const SAVED_GROUP_OPERATORS = new Set(["$inGroup", "$notInGroup"]);

/**
 * An attribute condition in words: `id = 123 and country = US`, with OR
 * groups joined by "or". `null` when it can't be said simply (advanced JSON,
 * or saved groups referenced from inside the condition).
 */
function conditionText(
  condition: string,
  lookups: QaOverrideNameLookups,
): string | null {
  const groups = jsonToConds(condition);
  if (!groups) return null;
  const texts: string[] = [];
  for (const group of groups) {
    const parts: string[] = [];
    for (const c of group) {
      if (c.field.startsWith("$") || SAVED_GROUP_OPERATORS.has(c.operator)) {
        return null;
      }
      if (c.operator === "$true" || c.operator === "$false") {
        parts.push(
          `${c.field} is ${c.operator === "$true" ? "TRUE" : "FALSE"}`,
        );
        continue;
      }
      const op = lookups.operatorText(c.operator);
      parts.push(
        NO_VALUE_OPERATORS.has(c.operator)
          ? `${c.field} ${op}`
          : [c.field, op, c.value].filter((p) => p !== "").join(" "),
      );
    }
    if (parts.length) texts.push(parts.join(" and "));
  }
  return texts.join(" or ");
}

function savedGroupsText(
  savedGroups: SavedGroupTargeting[],
  lookups: QaOverrideNameLookups,
): string {
  return savedGroups
    .filter((g) => g.ids.length)
    .map((g) => {
      const names = listValues(g.ids.map(lookups.savedGroupName));
      if (g.match === "none") return `not in ${names}`;
      if (g.match === "all" && g.ids.length > 1) return `all of ${names}`;
      return names;
    })
    .join(", ");
}

/**
 * The filled-in filters as short phrases, one per filter type. Values only,
 * no type labels; comma-separated within a type. `order` is the order the
 * filter cards appear in (defaults to attribute, groups, connections,
 * projects). Types with nothing in them are left out.
 */
export function summarizeQaOverrideAudience(
  filters: QaOverrideFilters,
  lookups: QaOverrideNameLookups,
  order: QaOverrideFilterKind[] = QA_OVERRIDE_FILTER_KINDS,
): QaOverrideAudienceSegment[] {
  const segments: QaOverrideAudienceSegment[] = [];
  const kinds = [
    ...order,
    ...QA_OVERRIDE_FILTER_KINDS.filter((k) => !order.includes(k)),
  ];
  for (const kind of kinds) {
    switch (kind) {
      case "condition": {
        if (!qaOverrideHasCondition(filters)) break;
        const text = conditionText(filters.condition ?? "{}", lookups);
        if (text === null) {
          segments.push({ kind, text: "a custom condition", custom: true });
        } else if (text) {
          segments.push({ kind, text });
        }
        break;
      }
      case "savedGroups": {
        const text = savedGroupsText(filters.savedGroups ?? [], lookups);
        if (text) segments.push({ kind, text });
        break;
      }
      case "sdkConnections": {
        const ids = filters.sdkConnections ?? [];
        if (ids.length) {
          segments.push({
            kind,
            text: listValues(ids.map(lookups.sdkConnectionName)),
          });
        }
        break;
      }
      case "projects": {
        const ids = filters.projects ?? [];
        if (ids.length) {
          segments.push({
            kind,
            text: listValues(ids.map(lookups.projectName)),
          });
        }
        break;
      }
    }
  }
  return segments;
}

/**
 * The summary as one plain sentence, as shown under "Who sees it":
 * "Anyone matching id = 123 AND Local dev (React)." In Test mode
 * (`usesExperimentTargeting`) the experiment's own targeting always leads.
 */
export function qaOverrideAudienceSentence({
  segments,
  environment,
  usesExperimentTargeting,
}: {
  segments: QaOverrideAudienceSegment[];
  environment?: string;
  usesExperimentTargeting?: boolean;
}): string {
  const values = segments.map((s) => s.text);
  if (usesExperimentTargeting) {
    return `${["Anyone matching the experiment's targeting", ...values].join(" AND ")}.`;
  }
  if (!values.length) {
    return environment
      ? `Everyone in ${environment}.`
      : "Everyone in the selected environment.";
  }
  return `Anyone matching ${values.join(" AND ")}.`;
}

// ---------------------------------------------------------------------------
// Add / edit form

export type QaOverrideFormValues = {
  environment: string;
  // Filter cards the user has added, in the order they were added. A card can
  // exist while still empty; that blocks saving rather than being dropped.
  filters: QaOverrideFilterKind[];
  condition: string;
  savedGroups: SavedGroupTargeting[];
  sdkConnections: string[];
  projects: string[];
  // Nothing is picked until the user chooses; the CTA waits for it.
  assignmentType: ExperimentQaOverrideAssignment["type"] | "";
  forcedVariationId: string;
};

export function activeQaOverrideFilters(
  filters?: QaOverrideFilters,
): QaOverrideFilterKind[] {
  if (!filters) return [];
  const kinds: QaOverrideFilterKind[] = [];
  if (qaOverrideHasCondition(filters)) kinds.push("condition");
  if (filters.savedGroups?.length) kinds.push("savedGroups");
  if (filters.sdkConnections?.length) kinds.push("sdkConnections");
  if (filters.projects?.length) kinds.push("projects");
  return kinds;
}

export function qaOverrideFormDefaults(
  existing?: Pick<
    ExperimentQaOverrideInterface,
    "environment" | "filters" | "assignment"
  >,
  defaultEnvironment = "",
): QaOverrideFormValues {
  return {
    environment: existing?.environment ?? defaultEnvironment,
    filters: activeQaOverrideFilters(existing?.filters),
    condition: existing?.filters.condition ?? "{}",
    savedGroups: existing?.filters.savedGroups ?? [],
    sdkConnections: existing?.filters.sdkConnections ?? [],
    projects: existing?.filters.projects ?? [],
    assignmentType: existing?.assignment.type ?? "",
    forcedVariationId:
      existing?.assignment.type === "forced"
        ? existing.assignment.variationId
        : "",
  };
}

// Operators that take no value, so an empty value box is fine.
const VALUELESS_OPERATORS = new Set([
  "$exists",
  "$notExists",
  "$empty",
  "$notEmpty",
  "$true",
  "$false",
]);

/** Whether the filter card of this kind has something usable in it. */
export function qaOverrideFilterIsComplete(
  values: QaOverrideFormValues,
  kind: QaOverrideFilterKind,
): boolean {
  switch (kind) {
    case "condition": {
      if (!values.condition || values.condition === "{}") return false;
      const conds = jsonToConds(values.condition);
      if (conds === null) {
        // Advanced JSON: anything that parses counts.
        try {
          JSON.parse(values.condition);
          return true;
        } catch {
          return false;
        }
      }
      return (
        conds.length > 0 &&
        conds.every(
          (group) =>
            group.length > 0 &&
            group.every(
              (c) =>
                !!c.field &&
                (VALUELESS_OPERATORS.has(c.operator) || c.value !== ""),
            ),
        )
      );
    }
    case "savedGroups":
      return (
        values.savedGroups.length > 0 &&
        values.savedGroups.every((g) => g.ids.length > 0)
      );
    case "sdkConnections":
      return values.sdkConnections.length > 0;
    case "projects":
      return values.projects.length > 0;
  }
}

/**
 * The form's filters that have something usable in them, for the live
 * summary: a card that was added but not filled in doesn't count yet.
 */
export function completeQaOverrideFilters(
  values: QaOverrideFormValues,
): QaOverrideFilters {
  const done = (kind: QaOverrideFilterKind) =>
    values.filters.includes(kind) && qaOverrideFilterIsComplete(values, kind);
  return {
    ...(done("condition") ? { condition: values.condition } : {}),
    ...(done("savedGroups") ? { savedGroups: values.savedGroups } : {}),
    ...(done("sdkConnections")
      ? { sdkConnections: values.sdkConnections }
      : {}),
    ...(done("projects") ? { projects: values.projects } : {}),
  };
}

export function isQaOverrideFormComplete(
  values: QaOverrideFormValues,
): boolean {
  if (!values.environment) return false;
  if (values.assignmentType === "") return false;
  if (values.assignmentType === "forced" && !values.forcedVariationId)
    return false;
  return values.filters.every((kind) =>
    qaOverrideFilterIsComplete(values, kind),
  );
}

export type QaOverrideBody = {
  filters: QaOverrideFilters;
  assignment: ExperimentQaOverrideAssignment;
};

/** The request body for a complete form. Cards the user removed are omitted. */
export function buildQaOverrideBody(
  values: QaOverrideFormValues,
): QaOverrideBody {
  const has = (kind: QaOverrideFilterKind) => values.filters.includes(kind);
  const filters: QaOverrideFilters = {
    ...(has("condition") && values.condition !== "{}"
      ? { condition: values.condition }
      : {}),
    ...(has("savedGroups") && values.savedGroups.length
      ? { savedGroups: values.savedGroups }
      : {}),
    ...(has("sdkConnections") && values.sdkConnections.length
      ? { sdkConnections: values.sdkConnections }
      : {}),
    ...(has("projects") && values.projects.length
      ? { projects: values.projects }
      : {}),
  };
  const assignment: ExperimentQaOverrideAssignment =
    values.assignmentType === "forced"
      ? { type: "forced", variationId: values.forcedVariationId }
      : { type: "random" };
  return { filters, assignment };
}

function normalizeBody(body: QaOverrideBody) {
  const f = body.filters;
  return {
    condition: qaOverrideHasCondition(f) ? f.condition : undefined,
    savedGroups: (f.savedGroups ?? [])
      .map((g) => ({ match: g.match, ids: [...g.ids].sort() }))
      .filter((g) => g.ids.length),
    sdkConnections: [...(f.sdkConnections ?? [])].sort(),
    projects: [...(f.projects ?? [])].sort(),
    assignment: body.assignment,
  };
}

/** Same effect on the payload, ignoring list order and empty leftovers. */
export function qaOverrideBodyEquals(
  a: QaOverrideBody,
  b: QaOverrideBody,
): boolean {
  return JSON.stringify(normalizeBody(a)) === JSON.stringify(normalizeBody(b));
}
