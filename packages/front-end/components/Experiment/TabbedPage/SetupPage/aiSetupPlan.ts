import { aiExperimentSetupSchema } from "shared/ai";
import type {
  DeliveryMethod,
  ManagedValueDataType,
} from "@/components/Experiment/TabbedPage/ManagedValuesContext";
import { AI_SETUP_FIXTURE } from "./aiSetupFixture";
import type { EndUnit } from "./setupDraft";

// PROTOTYPE: what "Set up with AI" writes into the new draft. A plan comes
// from exactly one source: the model's answer (planFromModel) or the fixed
// fixture (planFromFixture). The two are never blended: a field the model
// left out keeps the form's default, never the fixture's value, so a user who
// typed "US only" can't end up with the fixture's targeting.
//
// Only the hypothesis is required of the model. Everything else is optional:
// a field the input doesn't mention keeps the form's default (and stays on
// the To Do list where it's one of those), which is the right outcome, not
// a failure. A stated value that can't be used (an unknown metric, a date
// in the past) is dropped the same way.

export interface SetupPlan {
  deliveryType: DeliveryMethod;
  hypothesis: string;
  description: string;
  // One per variation, control first; sets how many there are. A null name
  // keeps the default ("Control", "Variation 1", ...).
  variations: { name: string | null; description: string }[];
  // The Values type's per-variation values, by variation index, only those
  // the input stated (null for the rest). null when none were stated, or the
  // type isn't Values.
  values: { dataType: ManagedValueDataType; byIndex: (string | null)[] } | null;
  // ISO date-time, in the future.
  scheduledStart: string | null;
  // The phase's targeting condition, as the experiment stores it ("" for
  // everyone).
  condition: string;
  // Share of matching users in the experiment, 0 to 1.
  coverage: number;
  // One per variation, summing to 1.
  variationWeights: number[];
  goalMetricId: string | null;
  secondaryMetrics: string[];
  guardrailMetrics: string[];
  // null: the Setup page's own default.
  duration: { endAfter: number; endUnit: EndUnit } | null;
}

// The create form's defaults, for fields the model didn't state.
const FORM_DEFAULTS: SetupPlan = {
  deliveryType: "values",
  hypothesis: "",
  description: "",
  variations: [
    { name: null, description: "" },
    { name: null, description: "" },
  ],
  values: null,
  scheduledStart: null,
  condition: "",
  coverage: 1,
  variationWeights: [0.5, 0.5],
  goalMetricId: null,
  secondaryMetrics: [],
  guardrailMetrics: [],
  duration: null,
};

// The fixture as a plan, resolved against the org: its metrics matched by
// name (case and surrounding space ignored) among the candidates, any not
// found left empty; its targeting only if the org has every attribute it
// uses, otherwise the default (everyone).
export function planFromFixture(ctx: {
  attributes: string[];
  metrics: { id: string; name: string }[];
}): SetupPlan {
  const byName = (name: string) =>
    ctx.metrics.find(
      (m) => m.name.trim().toLowerCase() === name.trim().toLowerCase(),
    )?.id ?? null;
  const ids = (names: string[]) =>
    names.map(byName).filter((id): id is string => id !== null);
  const { targeting, metrics } = AI_SETUP_FIXTURE;
  return {
    deliveryType: AI_SETUP_FIXTURE.deliveryType,
    hypothesis: AI_SETUP_FIXTURE.hypothesis,
    description: AI_SETUP_FIXTURE.description,
    variations: AI_SETUP_FIXTURE.variations.map((v) => ({
      name: v.name,
      description: v.description,
    })),
    values: {
      dataType: "string",
      byIndex: AI_SETUP_FIXTURE.variations.map((v) => v.value),
    },
    scheduledStart: null,
    condition: targeting.attributes.every((a) => ctx.attributes.includes(a))
      ? targeting.condition
      : "",
    coverage: AI_SETUP_FIXTURE.coverage,
    variationWeights: [...AI_SETUP_FIXTURE.variationWeights],
    goalMetricId: byName(metrics.goal),
    secondaryMetrics: ids(metrics.secondary),
    guardrailMetrics: ids(metrics.guardrail),
    duration: { ...AI_SETUP_FIXTURE.duration },
  };
}

const MAX_VARIATIONS = 10;
const MAX_DURATION_DAYS = 365;

// Percentages to weights summing to exactly 1 (4 decimal places; any
// rounding remainder goes to the last).
function toWeights(percents: number[]): number[] {
  const total = percents.reduce((a, b) => a + b, 0);
  const weights = percents.map((p) => Math.round((p / total) * 10000) / 10000);
  const rest = weights.slice(0, -1).reduce((a, b) => a + b, 0);
  weights[weights.length - 1] = Math.round((1 - rest) * 10000) / 10000;
  return weights;
}

// The model's targeting as a condition, or why it can't be used: an
// attribute the org doesn't have, a condition with no values, or the same
// attribute twice (a condition object can hold each only once).
function toCondition(
  targeting: NonNullable<
    ReturnType<typeof aiExperimentSetupSchema.parse>["targeting"]
  >,
  attributes: string[],
): { condition: string } | { rejected: string } {
  if (!targeting.length) return { rejected: "no conditions" };
  const condition: Record<string, unknown> = {};
  for (const { attribute, operator, values } of targeting) {
    if (!attributes.includes(attribute))
      return { rejected: `unknown attribute "${attribute}"` };
    if (attribute in condition)
      return { rejected: `attribute "${attribute}" used twice` };
    if (!values.length) return { rejected: `no values for "${attribute}"` };
    if (operator === "is") {
      condition[attribute] = values.length === 1 ? values[0] : { $in: values };
    } else if (operator === "is not") {
      condition[attribute] =
        values.length === 1 ? { $ne: values[0] } : { $nin: values };
    } else if (operator === "is any of") {
      condition[attribute] = { $in: values };
    } else {
      condition[attribute] = { $nin: values };
    }
  }
  return { condition: JSON.stringify(condition) };
}

// Stated values with the data type they share: boolean if every one is
// true/false, number if every one is a number, JSON if every one is a JSON
// object or array, otherwise string. Only formats what was stated; never
// supplies a value.
function typeValues(stated: string[]): {
  dataType: ManagedValueDataType;
  normalize: (v: string) => string;
} {
  const trimmed = stated.map((v) => v.trim());
  if (trimmed.every((v) => /^(true|false)$/i.test(v))) {
    return { dataType: "boolean", normalize: (v) => v.trim().toLowerCase() };
  }
  if (trimmed.every((v) => v !== "" && Number.isFinite(Number(v)))) {
    return { dataType: "number", normalize: (v) => v.trim() };
  }
  const isJSON = (v: string) => {
    if (!/^[[{]/.test(v)) return false;
    try {
      JSON.parse(v);
      return true;
    } catch {
      return false;
    }
  };
  if (trimmed.every(isJSON)) {
    return { dataType: "json", normalize: (v) => v.trim() };
  }
  return { dataType: "string", normalize: (v) => v };
}

// An ISO date (taken as midnight, local time) or date-time, as an ISO
// date-time, or null if it isn't one.
function parseStart(value: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const date = dateOnly
    ? new Date(+dateOnly[1], +dateOnly[2] - 1, +dateOnly[3])
    : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

// Why an answer was refused, for the dev-only diagnostic in the create form
// (DEBUG_AI_SETUP). Filled in when passed; never affects the result.
export interface PlanDiagnostics {
  malformed: boolean;
  // The hypothesis, the one required field, was missing or unusable.
  missingCore: boolean;
  // Optional fields the model left out ("field: absent") or that were
  // dropped ("field: <why>"). Neither fails the answer.
  issues: string[];
}

// The model's answer as a plan, or null if it's unusable: not the expected
// shape, or no usable hypothesis. Every other field is optional: left out or
// unusable, it keeps the form's default.
export function planFromModel(
  raw: unknown,
  ctx: { attributes: string[]; metricIds: string[]; now?: Date },
  diagnostics?: PlanDiagnostics,
): SetupPlan | null {
  const parsed = aiExperimentSetupSchema.safeParse(raw);
  if (!parsed.success) {
    if (diagnostics) diagnostics.malformed = true;
    return null;
  }
  const a = parsed.data;
  const now = ctx.now ?? new Date();
  const plan: SetupPlan = { ...FORM_DEFAULTS };
  const note = (field: string, why: string) =>
    diagnostics?.issues.push(`${field}: ${why}`);

  // Required core.
  const hypothesis = a.hypothesis?.trim() ?? "";
  if (!hypothesis) {
    if (diagnostics) diagnostics.missingCore = true;
    return null;
  }
  plan.hypothesis = hypothesis;

  // Optional, each on its own.
  const description = a.description?.trim() ?? "";
  if (description) plan.description = description;
  else note("description", "absent");

  if (a.experimentType) plan.deliveryType = a.experimentType;
  else note("experimentType", "absent");

  if (!a.targeting) {
    note("targeting", "absent");
  } else {
    const result = toCondition(a.targeting, ctx.attributes);
    if ("condition" in result) plan.condition = result.condition;
    else note("targeting", result.rejected);
  }

  // Variations first: when listed, they set how many there are, and the
  // split has to match.
  const listed = a.variations;
  let count = FORM_DEFAULTS.variations.length;
  // Whether the model's list of variations was usable (and so applied).
  let listedOK = false;
  if (!listed) {
    note("variations", "absent");
  } else if (listed.length < 2 || listed.length > MAX_VARIATIONS) {
    note("variations", `unparseable value (${listed.length} variations)`);
  } else {
    count = listed.length;
    listedOK = true;
    plan.variations = listed.map((v) => ({
      name: v.name?.trim() || null,
      description: v.description?.trim() ?? "",
    }));
  }

  const split = a.trafficSplit;
  const percents = split?.variationPercents ?? [];
  const total = percents.reduce((x, y) => x + y, 0);
  if (!split) {
    note("trafficSplit", "absent");
    plan.variationWeights = equalWeights(count);
  } else if (
    !(
      split.coveragePercent > 0 &&
      split.coveragePercent <= 100 &&
      percents.length >= 2 &&
      percents.length <= MAX_VARIATIONS &&
      percents.every((p) => p >= 0) &&
      Math.abs(total - 100) <= 1
    )
  ) {
    note("trafficSplit", "unparseable value");
    plan.variationWeights = equalWeights(count);
  } else if (listedOK && count !== percents.length) {
    note(
      "trafficSplit",
      `${percents.length} shares for ${plan.variations.length} variations`,
    );
    plan.variationWeights = equalWeights(count);
  } else {
    plan.coverage = Math.round(split.coveragePercent * 100) / 10000;
    plan.variationWeights = toWeights(percents);
    if (!listedOK) {
      // Unlisted variations: the split says how many.
      plan.variations = percents.map(() => ({ name: null, description: "" }));
    }
  }

  // Values: only those stated outright, and only for the Values type.
  const stated = (listedOK && listed ? listed : []).map((v) =>
    v.value !== null && v.value.trim() !== "" ? v.value : null,
  );
  const given = stated.filter((v): v is string => v !== null);
  if (!given.length) {
    note("values", "absent");
  } else if (plan.deliveryType !== "values") {
    note("values", `dropped: the type is ${plan.deliveryType}, not values`);
  } else {
    const { dataType, normalize } = typeValues(given);
    plan.values = {
      dataType,
      byIndex: stated.map((v) => (v === null ? null : normalize(v))),
    };
  }

  if (!a.goalMetricId) {
    note("goalMetricId", "absent");
  } else if (ctx.metricIds.includes(a.goalMetricId)) {
    plan.goalMetricId = a.goalMetricId;
  } else {
    note("goalMetricId", `unknown metric "${a.goalMetricId}"`);
  }

  // Secondary and guardrail metrics: known ids only, each once, and not the
  // goal metric again.
  const knownMetrics = (
    field: string,
    list: string[] | null,
    exclude: string[],
  ): string[] => {
    if (!list || !list.length) {
      note(field, "absent");
      return [];
    }
    const kept: string[] = [];
    for (const id of list) {
      if (!ctx.metricIds.includes(id)) note(field, `unknown metric "${id}"`);
      else if (!kept.includes(id) && !exclude.includes(id)) kept.push(id);
    }
    return kept;
  };
  const goal = plan.goalMetricId ? [plan.goalMetricId] : [];
  plan.secondaryMetrics = knownMetrics(
    "secondaryMetricIds",
    a.secondaryMetricIds,
    goal,
  );
  plan.guardrailMetrics = knownMetrics(
    "guardrailMetricIds",
    a.guardrailMetricIds,
    [...goal, ...plan.secondaryMetrics],
  );

  const d = a.duration;
  if (!d) {
    note("duration", "absent");
  } else if (
    Number.isInteger(d.amount) &&
    d.amount > 0 &&
    d.amount * (d.unit === "weeks" ? 7 : 1) <= MAX_DURATION_DAYS
  ) {
    plan.duration = { endAfter: d.amount, endUnit: d.unit };
  } else {
    note("duration", "unparseable value");
  }

  if (!a.scheduledStart) {
    note("scheduledStart", "absent");
  } else {
    const start = parseStart(a.scheduledStart);
    if (!start) note("scheduledStart", "unparseable value");
    else if (start <= now) note("scheduledStart", "date in the past");
    else plan.scheduledStart = start.toISOString();
  }

  return plan;
}

// Even weights summing to exactly 1.
function equalWeights(count: number): number[] {
  return toWeights(Array.from({ length: count }, () => 1));
}
