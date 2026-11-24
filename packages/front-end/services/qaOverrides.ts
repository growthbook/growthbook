import {
  ExperimentQaOverrideAssignment,
  ExperimentQaOverrideInterface,
  QaOverrideFilters,
} from "shared/types/experiment-qa-override";
import { SavedGroupTargeting } from "shared/validators";
import {
  qaOverrideHasCondition,
  qaOverrideHasOwnTargeting,
  sortQaOverrides,
} from "shared/util";
import groupBy from "lodash/groupBy";
import { jsonToConds } from "@/services/features";

export type QaOverrideGroup<T> = {
  environment: string;
  rows: { item: T; priority: number }[];
};

export function groupQaOverrides<
  T extends Pick<
    ExperimentQaOverrideInterface,
    "environment" | "order" | "dateCreated"
  >,
>(overrides: T[], environmentOrder: string[]): QaOverrideGroup<T>[] {
  const byEnv = new Map(
    Object.entries(groupBy(sortQaOverrides(overrides), "environment")),
  );
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

export function qaOverridesNeedGrouping<T>(
  groups: QaOverrideGroup<T>[],
): boolean {
  return groups.some((g) => g.rows.length > 1);
}

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

export type QaOverrideAudienceSegment = {
  kind: QaOverrideFilterKind;
  text: string;
  custom?: boolean;
};

export const QA_OVERRIDE_SUMMARY_MAX_VALUES = 3;

function listValues(names: string[]): string {
  if (names.length <= QA_OVERRIDE_SUMMARY_MAX_VALUES) return names.join(", ");
  const shown = names.slice(0, QA_OVERRIDE_SUMMARY_MAX_VALUES).join(", ");
  return `${shown} +${names.length - QA_OVERRIDE_SUMMARY_MAX_VALUES} more`;
}

const VALUELESS_OPERATORS = new Set([
  "$exists",
  "$notExists",
  "$empty",
  "$notEmpty",
  "$true",
  "$false",
]);
const SAVED_GROUP_OPERATORS = new Set(["$inGroup", "$notInGroup"]);

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
        VALUELESS_OPERATORS.has(c.operator)
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

export type QaOverrideAudiencePart = {
  type: "text" | "value" | "and";
  text: string;
  suffix?: string;
  custom?: boolean;
};

export function qaOverrideAudienceParts({
  segments,
  environment,
  usesExperimentTargeting = false,
  variant,
}: {
  segments: QaOverrideAudienceSegment[];
  environment?: string;
  usesExperimentTargeting?: boolean;
  variant: "sentence" | "inline";
}): QaOverrideAudiencePart[] {
  const sentence = variant === "sentence";
  const parts: QaOverrideAudiencePart[] = [];

  if (usesExperimentTargeting) {
    parts.push({
      type: "text",
      text: sentence
        ? "Anyone matching the experiment\u2019s targeting"
        : "Experiment targeting",
    });
  } else if (!segments.length) {
    parts.push({ type: "text", text: "Everyone in" });
    parts.push(
      environment
        ? { type: "value", text: environment }
        : { type: "text", text: "the selected environment" },
    );
  } else if (sentence) {
    parts.push({ type: "text", text: "Anyone matching" });
  }

  segments.forEach((segment, i) => {
    if (i > 0 || usesExperimentTargeting)
      parts.push({ type: "and", text: "AND" });
    parts.push(
      segment.custom
        ? {
            type: "text",
            text: sentence ? segment.text : "Custom condition",
            custom: true,
          }
        : { type: "value", text: segment.text },
    );
  });

  if (sentence) parts[parts.length - 1].suffix = ".";
  return parts;
}

export type QaOverrideFormValues = {
  environment: string;
  filters: QaOverrideFilterKind[];
  condition: string;
  savedGroups: SavedGroupTargeting[];
  sdkConnections: string[];
  projects: string[];
  assignmentType: ExperimentQaOverrideAssignment["type"] | "";
  forcedVariationId: string;
  // Random assignment only: serve the experiment's own targeting, or replace
  // it with the attribute and Saved Group filters above.
  targetingMode: QaOverrideTargetingMode;
};

export type QaOverrideTargetingMode = "experiment" | "custom";

// Attribute and Saved Group filters say who sees the override. The others
// say which SDK Connections receive it.
export const QA_OVERRIDE_TARGETING_KINDS: QaOverrideFilterKind[] = [
  "condition",
  "savedGroups",
];

// A forced variation always uses the override's own targeting.
export function qaOverrideFormUsesOwnTargeting(
  values: Pick<QaOverrideFormValues, "assignmentType" | "targetingMode">,
): boolean {
  return (
    values.assignmentType !== "random" || values.targetingMode === "custom"
  );
}

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
  // When given, a forced variation that is no longer one of these starts
  // empty, so it has to be picked again.
  variationIds?: string[],
): QaOverrideFormValues {
  const forcedVariationId =
    existing?.assignment.type === "forced"
      ? existing.assignment.variationId
      : "";
  return {
    environment: existing?.environment ?? defaultEnvironment,
    filters: activeQaOverrideFilters(existing?.filters),
    condition: existing?.filters.condition ?? "{}",
    savedGroups: existing?.filters.savedGroups ?? [],
    sdkConnections: existing?.filters.sdkConnections ?? [],
    projects: existing?.filters.projects ?? [],
    assignmentType: existing?.assignment.type ?? "",
    forcedVariationId:
      !variationIds || variationIds.includes(forcedVariationId)
        ? forcedVariationId
        : "",
    targetingMode:
      existing && qaOverrideHasOwnTargeting(existing.filters)
        ? "custom"
        : "experiment",
  };
}

export function qaOverrideFilterIsComplete(
  values: QaOverrideFormValues,
  kind: QaOverrideFilterKind,
): boolean {
  switch (kind) {
    case "condition": {
      if (!values.condition || values.condition === "{}") return false;
      const conds = jsonToConds(values.condition);
      if (conds === null) {
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

export function qaOverrideFiltersFromForm(
  values: QaOverrideFormValues,
): QaOverrideFilters {
  const ownTargeting = qaOverrideFormUsesOwnTargeting(values);
  const done = (kind: QaOverrideFilterKind) =>
    values.filters.includes(kind) &&
    (ownTargeting || !QA_OVERRIDE_TARGETING_KINDS.includes(kind)) &&
    qaOverrideFilterIsComplete(values, kind);
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
  const ownTargeting = qaOverrideFormUsesOwnTargeting(values);
  // Targeting filters left over from custom mode aren't saved, so they
  // can't hold the form up.
  const used = values.filters.filter(
    (kind) => ownTargeting || !QA_OVERRIDE_TARGETING_KINDS.includes(kind),
  );
  if (!used.every((kind) => qaOverrideFilterIsComplete(values, kind))) {
    return false;
  }
  // Custom targeting with nothing in it would silently mean "everyone".
  if (values.assignmentType === "random" && values.targetingMode === "custom") {
    return used.some((kind) => QA_OVERRIDE_TARGETING_KINDS.includes(kind));
  }
  return true;
}

export type QaOverrideBody = {
  filters: QaOverrideFilters;
  assignment: ExperimentQaOverrideAssignment;
};

export function buildQaOverrideBody(
  values: QaOverrideFormValues,
): QaOverrideBody {
  const assignment: ExperimentQaOverrideAssignment =
    values.assignmentType === "forced"
      ? { type: "forced", variationId: values.forcedVariationId }
      : { type: "random" };
  return { filters: qaOverrideFiltersFromForm(values), assignment };
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

export function qaOverrideBodyEquals(
  a: QaOverrideBody,
  b: QaOverrideBody,
): boolean {
  return JSON.stringify(normalizeBody(a)) === JSON.stringify(normalizeBody(b));
}
