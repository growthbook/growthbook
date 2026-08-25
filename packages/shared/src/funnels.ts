import type { FunnelDataset } from "shared/validators";
import type {
  ConversionWindowUnit,
  FunnelOrdering,
  FunnelSettings,
  FunnelStep,
} from "shared/types/fact-table";

/** Shared funnel rules and SQL semantics. */
export const MAX_FUNNEL_STEPS = 20;

const CONVERSION_WINDOW_UNIT_TO_SECONDS: Record<ConversionWindowUnit, number> =
  {
    minutes: 60,
    hours: 3600,
    days: 86400,
    weeks: 86400 * 7,
  };

export function conversionWindowToSeconds(window: {
  unit: ConversionWindowUnit;
  value: number;
}): number {
  return (
    Math.max(1, Math.round(window.value)) *
    CONVERSION_WINDOW_UNIT_TO_SECONDS[window.unit]
  );
}

/**
 * Index of the step that anchors `index`'s ordering and conversion window, or
 * null when only optional steps precede it. Optional steps do not anchor later
 * steps, so this walks backward from `index - 1` to the nearest required step.
 * A null result means the caller should anchor on exposure (experiment funnel
 * metrics) or step 0 (product analytics).
 */
export function getFunnelAnchorStepIndex(
  steps: { optional: boolean }[],
  index: number,
): number | null {
  for (let i = index - 1; i >= 0; i--) {
    if (!steps[i].optional) return i;
  }
  return null;
}

/**
 * Build the "previous resolved timestamp" expression for step `index`.
 *
 * Anchors on the nearest preceding required step (see
 * `getFunnelAnchorStepIndex`). When every preceding step is optional, falls
 * back to `exposureColumn` (experiment funnel metrics) or step 0 (product
 * analytics), so an optional early step never blocks later conversions.
 *
 * `resolvedTsColumn` maps a step index to that step's resolved-timestamp column
 * name, which differs between the two callers.
 */
export function buildPrevResolvedExpr({
  steps,
  index,
  resolvedTsColumn,
  alias = "",
  exposureColumn,
}: {
  steps: { optional: boolean }[];
  index: number;
  resolvedTsColumn: (stepIndex: number) => string;
  alias?: string;
  /** Bare column name (e.g. `timestamp`); prefixed with `alias` when set. */
  exposureColumn?: string;
}): string {
  const prefix = alias ? `${alias}.` : "";
  const anchorIndex = getFunnelAnchorStepIndex(steps, index);
  if (anchorIndex !== null) {
    return `${prefix}${resolvedTsColumn(anchorIndex)}`;
  }
  // No required step precedes this one. Experiment funnels anchor on exposure;
  // product-analytics funnels anchor on step 0, which their qualifying-users
  // filter already guarantees is non-null. Never emit a NULL bound, which
  // would silently drop every candidate event.
  return `${prefix}${exposureColumn ?? resolvedTsColumn(0)}`;
}

// Funnel definition rules
// Builder funnels support multiple fact tables; funnel fact metrics do not yet.

export type FunnelRuleCode =
  | "too_few_steps"
  | "too_many_steps"
  | "missing_step_fact_table"
  | "multi_fact_table"
  | "unknown_fact_table"
  | "datasource_mismatch"
  | "missing_step_name"
  | "unsupported_ordering"
  | "session_based";

/** `"funnel"` rules apply to builders and metrics; `"fact_metric"` rules only to metrics. */
export type FunnelRuleScope = "funnel" | "fact_metric";

export interface FunnelRuleViolation {
  code: FunnelRuleCode;
  scope: FunnelRuleScope;
  message: string;
}

/** The only fact table fields the rules need. */
export interface FunnelRuleFactTable {
  id: string;
  datasource: string;
  userIdTypes: string[];
}

export interface FunnelRuleInput {
  steps: FunnelStep[];
  ordering?: FunnelOrdering;
  sessionBased?: boolean;
  /** Datasource the funnel belongs to; every step's fact table must match. */
  datasourceId: string;
  getFactTable: (id: string) => FunnelRuleFactTable | undefined;
}

/** Returns all definition violations in stable priority order. */
export function getFunnelRuleViolations({
  steps,
  ordering,
  sessionBased,
  datasourceId,
  getFactTable,
}: FunnelRuleInput): FunnelRuleViolation[] {
  const violations: FunnelRuleViolation[] = [];
  const add = (code: FunnelRuleCode, scope: FunnelRuleScope, message: string) =>
    violations.push({ code, scope, message });

  if (steps.length < 2) {
    add("too_few_steps", "funnel", "Funnel metrics need at least 2 steps");
  }
  if (steps.length > MAX_FUNNEL_STEPS) {
    add(
      "too_many_steps",
      "funnel",
      `Funnels can have at most ${MAX_FUNNEL_STEPS} steps (this one has ${steps.length})`,
    );
  }

  // TODO(funnel): support non-sequential ordering
  if ((ordering ?? "sequential") !== "sequential") {
    add(
      "unsupported_ordering",
      "fact_metric",
      "Only sequential funnel ordering is supported for now",
    );
  }
  // TODO(funnel): support session-based funnels
  if (sessionBased) {
    add(
      "session_based",
      "fact_metric",
      "Session-based funnels are not supported for now",
    );
  }

  const stepsMissingFactTable = steps
    .map((step, i) => (step.factTableId ? null : i + 1))
    .filter((n): n is number => n !== null);
  if (stepsMissingFactTable.length) {
    add(
      "missing_step_fact_table",
      "funnel",
      `Every funnel step needs a fact table (missing on step ${stepsMissingFactTable.join(", ")})`,
    );
  }

  const factTableIds = Array.from(
    new Set(steps.map((s) => s.factTableId).filter(Boolean)),
  );

  // TODO(funnel): multi-fact table support for funnel metrics
  if (factTableIds.length > 1) {
    add(
      "multi_fact_table",
      "fact_metric",
      "All funnel steps must come from the same fact table for now",
    );
  }

  for (const id of factTableIds) {
    const factTable = getFactTable(id);
    if (!factTable) {
      add("unknown_fact_table", "funnel", "Could not find funnel fact table");
      continue;
    }
    if (factTable.datasource !== datasourceId) {
      add(
        "datasource_mismatch",
        "funnel",
        "Funnel Fact Table must belong to the metric's Data Source",
      );
    }
  }

  steps.forEach((step, i) => {
    if (!step.name) {
      add(
        "missing_step_name",
        "fact_metric",
        `Funnel step ${i + 1} must have a name`,
      );
    }
  });

  return violations;
}

/** Returns rules that apply to a Product Analytics funnel exploration. */
export function getFunnelBuilderViolations(
  input: Omit<FunnelRuleInput, "ordering" | "sessionBased">,
): FunnelRuleViolation[] {
  return getFunnelRuleViolations(input).filter((v) => v.scope === "funnel");
}

/** Returns reasons a Product Analytics funnel cannot be saved as a Fact Metric. */
export function getFunnelSaveBlockers({
  dataset,
  datasourceId,
  getFactTable,
  datasourceSupportsFunnels = true,
}: {
  dataset: Pick<FunnelDataset, "steps">;
  datasourceId: string;
  getFactTable: (id: string) => FunnelRuleFactTable | undefined;
  datasourceSupportsFunnels?: boolean;
}): string[] {
  const blockers = getFunnelRuleViolations({
    steps: dataset.steps,
    datasourceId,
    getFactTable,
  }).map((v) => v.message);

  if (!datasourceSupportsFunnels) {
    blockers.push(
      "Funnel metrics aren't supported for this data source's warehouse type",
    );
  }

  return blockers;
}

// Translation between the two funnel containers

/** Converts a builder funnel to metric settings, dropping display-only fields. */
export function funnelDatasetToFunnelSettings(
  dataset: Pick<FunnelDataset, "steps" | "concurrencyWindowSeconds">,
): FunnelSettings {
  return {
    steps: dataset.steps,
    ordering: "sequential",
    ...(dataset.concurrencyWindowSeconds === undefined
      ? {}
      : { concurrencyWindowSeconds: dataset.concurrencyWindowSeconds }),
  };
}

/** Converts metric settings to a builder funnel with a caller-selected unit. */
export function funnelSettingsToFunnelDataset(
  settings: Pick<FunnelSettings, "steps" | "concurrencyWindowSeconds">,
  unit: string | null,
): FunnelDataset {
  return {
    type: "funnel",
    unit,
    steps: settings.steps,
    ...(settings.concurrencyWindowSeconds === undefined
      ? {}
      : { concurrencyWindowSeconds: settings.concurrencyWindowSeconds }),
  };
}

/** Selects a preferred unit shared by every step's Fact Table, if one exists. */
export function deriveFunnelUnit({
  steps,
  getFactTable,
  preferredUnit,
}: {
  steps: FunnelStep[];
  getFactTable: (id: string) => FunnelRuleFactTable | undefined;
  preferredUnit?: string | null;
}): string | null {
  if (!steps.length) return null;

  const factTables = steps.map((s) =>
    s.factTableId ? getFactTable(s.factTableId) : undefined,
  );
  // Any unresolved step means we can't prove a unit exists everywhere.
  if (factTables.some((ft) => !ft)) return null;

  const shared = (factTables as FunnelRuleFactTable[]).reduce<string[] | null>(
    (acc, ft) => {
      const ids = ft.userIdTypes ?? [];
      return acc === null ? [...ids] : acc.filter((id) => ids.includes(id));
    },
    null,
  );

  if (!shared?.length) return null;
  if (preferredUnit && shared.includes(preferredUnit)) return preferredUnit;
  return shared[0];
}
