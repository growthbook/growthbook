import {
  ExperimentQaOverrideAssignment,
  ExperimentQaOverrideInterface,
  QaOverrideFilters,
} from "shared/types/experiment-qa-override";
import { SavedGroupTargeting } from "shared/validators";
import { qaOverrideHasCondition, sortQaOverrides } from "shared/util";
import { jsonToConds } from "@/services/features";

// Pure helpers behind the QA overrides UI: grouping rows by environment,
// summarizing filters into chips, and the add/edit form's shape. Kept free
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
// Filter chips

export type QaOverrideFilterKind = keyof QaOverrideFilters;

export const QA_OVERRIDE_FILTER_KINDS: QaOverrideFilterKind[] = [
  "condition",
  "savedGroups",
  "sdkConnections",
  "projects",
];

export type QaOverrideFilterChip = {
  kind: QaOverrideFilterKind;
  label: string;
  // A condition too involved for a one-line chip; the full filter popover
  // shows it instead.
  custom?: boolean;
};

export type QaOverrideNameLookups = {
  savedGroupName: (id: string) => string;
  sdkConnectionName: (id: string) => string;
  projectName: (id: string) => string;
  operatorText: (operator: string) => string;
};

export type QaOverrideFilterSummary = {
  chips: QaOverrideFilterChip[];
  visible: QaOverrideFilterChip[];
  hidden: number;
};

export const QA_OVERRIDE_VISIBLE_CHIPS = 2;

/**
 * Filters as short chips: `id = 123`, `Group: QA team`, `SDK: Local dev`,
 * `Project: Checkout`. Only the first few are meant to be shown; the rest
 * are counted in `hidden` for a "+N" chip.
 */
export function summarizeQaOverrideFilters(
  filters: QaOverrideFilters,
  lookups: QaOverrideNameLookups,
  maxVisible = QA_OVERRIDE_VISIBLE_CHIPS,
): QaOverrideFilterSummary {
  const chips: QaOverrideFilterChip[] = [];

  if (qaOverrideHasCondition(filters)) {
    const conds = jsonToConds(filters.condition ?? "{}");
    // Advanced JSON, OR groups, or more clauses than fit: one chip, with the
    // detail in the popover.
    if (!conds || conds.length !== 1 || conds[0].length > maxVisible) {
      chips.push({
        kind: "condition",
        label: "Custom condition",
        custom: true,
      });
    } else {
      for (const c of conds[0]) {
        const op = lookups.operatorText(c.operator);
        chips.push({
          kind: "condition",
          label: [c.field, op, c.value].filter((s) => s !== "").join(" "),
        });
      }
    }
  }

  const groupIds = (filters.savedGroups ?? []).flatMap((g) => g.ids);
  if (groupIds.length) {
    chips.push({
      kind: "savedGroups",
      label: `Group: ${groupIds.map(lookups.savedGroupName).join(", ")}`,
    });
  }
  for (const id of filters.sdkConnections ?? []) {
    chips.push({
      kind: "sdkConnections",
      label: `SDK: ${lookups.sdkConnectionName(id)}`,
    });
  }
  for (const id of filters.projects ?? []) {
    chips.push({
      kind: "projects",
      label: `Project: ${lookups.projectName(id)}`,
    });
  }

  return {
    chips,
    visible: chips.slice(0, maxVisible),
    hidden: Math.max(0, chips.length - maxVisible),
  };
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
