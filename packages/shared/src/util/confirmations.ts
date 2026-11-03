import type { HttpVerb } from "../api-spec";
import {
  CONFIRM_ACTIONS,
  CONFIRM_MODEL_BY_TAG,
  RECOMMENDED_CONFIRM_ACTIONS,
  type HeldAction,
  type ConfirmAction,
  type ConfirmRule,
} from "../validators/confirmations";

// Whether a rule's action ("*", "recommended", a whole category like
// "feature.*", or one action) covers this action.
export const actionCovers = (ruleAction: string, action: string) =>
  ruleAction === "*" ||
  ruleAction === action ||
  (ruleAction === "recommended" &&
    (RECOMMENDED_CONFIRM_ACTIONS as readonly string[]).includes(action)) ||
  (ruleAction.endsWith(".*") && action.startsWith(ruleAction.slice(0, -1)));

// An action with no environments matches any environment list.
export function matchConfirmRules(
  rules: ConfirmRule[],
  actions: HeldAction[],
): HeldAction[] {
  return actions.filter(({ action, environments }) =>
    rules.some(
      (rule) =>
        rule.actions.some((a) => actionCovers(a, action)) &&
        (!rule.environments?.length ||
          !environments.length ||
          environments.some((env) => rule.environments?.includes(env))),
    ),
  );
}

function routeModel(tags: readonly string[] | undefined) {
  return (
    tags
      ?.map(
        (tag) => CONFIRM_MODEL_BY_TAG[tag as keyof typeof CONFIRM_MODEL_BY_TAG],
      )
      .find(Boolean) ?? null
  );
}

// The actions a route may hold for: its own, or for a write that declares none,
// `<model>.other` on a live model and `other.write` anywhere else. Declaring
// none (`[]`) marks a write that only reads or computes.
export function routeConfirmation(
  method: HttpVerb,
  tags: readonly string[] | undefined,
  declared: readonly ConfirmAction[] | undefined,
): readonly ConfirmAction[] {
  if (declared) return declared;
  if (method === "get") return [];
  const model = routeModel(tags);
  return [model ? `${model}.other` : "other.write"];
}

// Request fields that arm a publish to run later, without anyone present.
const ARMING_FIELDS = ["autoPublishOnApproval", "scheduledPublishAt"];
// An experiment's schedule arms a start or stop the same way.
const SCHEDULE_FIELD = "statusUpdateSchedule";

// A scheduled start or stop happens later with no one present.
export const scheduleActions = (
  schedule: { startAt?: unknown; stopAt?: unknown; stopAfter?: unknown } | null,
): ConfirmAction[] => [
  ...(schedule?.startAt ? (["experiment.start"] as const) : []),
  ...(schedule?.stopAt || schedule?.stopAfter
    ? (["experiment.stop"] as const)
    : []),
];

const knownActions = (actions: string[]) =>
  actions.filter((a): a is ConfirmAction =>
    (CONFIRM_ACTIONS as readonly string[]).includes(a),
  );

// What a request arms to run later. Confirming the arming confirms the
// action, which then runs unheld.
export function armedActions(
  tags: readonly string[] | undefined,
  body: Record<string, unknown>,
): ConfirmAction[] {
  const model = routeModel(tags);
  const schedule = (body[SCHEDULE_FIELD] ?? {}) as Record<string, unknown>;
  return knownActions([
    ...(ARMING_FIELDS.some((field) => !!body[field])
      ? [`${model}.publish`]
      : []),
    ...(model === "experiment" ? scheduleActions(schedule) : []),
  ]);
}

export function armableActions(
  tags: readonly string[] | undefined,
  fields: string[],
): ConfirmAction[] {
  const model = routeModel(tags);
  return knownActions([
    ...(ARMING_FIELDS.some((field) => fields.includes(field))
      ? [`${model}.publish`]
      : []),
    ...(model === "experiment" && fields.includes(SCHEDULE_FIELD)
      ? ["experiment.start", "experiment.stop"]
      : []),
  ]);
}
