import {
  CONFIRM_ACTIONS,
  CONFIRM_MODEL_BY_TAG,
  type HeldAction,
  type ConfirmAction,
  type ConfirmRule,
} from "../validators/confirmations";

// The actions any rule holds. A rule names an action, a whole category
// ("override.*") or everything ("*"); an action with no environments matches
// any environment list.
// Whether a rule's action ("*", a whole category like "feature.*", or one
// action) covers this action.
export const actionCovers = (ruleAction: string, action: string) =>
  ruleAction === "*" ||
  ruleAction === action ||
  (ruleAction.endsWith(".*") && action.startsWith(ruleAction.slice(0, -1)));

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

// The live model a route writes to, from its API tags.
export function routeModel(tags: readonly string[] | undefined) {
  return (
    tags
      ?.map(
        (tag) => CONFIRM_MODEL_BY_TAG[tag as keyof typeof CONFIRM_MODEL_BY_TAG],
      )
      .find(Boolean) ?? null
  );
}

// The actions a route may hold for: its own, or `<model>.other` for a write to a
// live model that declares none.
export function routeConfirmation(
  method: string,
  tags: readonly string[] | undefined,
  declared: readonly ConfirmAction[] | undefined,
): readonly ConfirmAction[] {
  if (declared) return declared;
  if (method.toLowerCase() === "get") return [];
  const model = routeModel(tags);
  return model ? [`${model}.other`] : [];
}

// Request fields that arm a publish to run later, without anyone present.
const ARMING_FIELDS = ["autoPublishOnApproval", "scheduledPublishAt"];
// An experiment's schedule arms a start or stop the same way.
const SCHEDULE_FIELD = "statusUpdateSchedule";

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
    ...(model === "experiment" && schedule.startAt ? ["experiment.start"] : []),
    ...(model === "experiment" && (schedule.stopAt || schedule.stopAfter)
      ? ["experiment.stop"]
      : []),
  ]);
}

// What a route can arm, from the request fields it accepts.
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
