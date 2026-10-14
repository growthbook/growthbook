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
export function matchConfirmRules(
  rules: ConfirmRule[],
  actions: HeldAction[],
): HeldAction[] {
  return actions.filter(({ action, environments }) =>
    rules.some(
      (rule) =>
        rule.actions.some(
          (a) =>
            a === "*" ||
            a === action ||
            (a.endsWith(".*") && action.startsWith(a.slice(0, -1))),
        ) &&
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
export const ARMING_FIELDS = ["autoPublishOnApproval", "scheduledPublishAt"];

// What arming a publish on this route holds as: the publish itself.
export function armedPublishAction(
  tags: readonly string[] | undefined,
): ConfirmAction | null {
  const action = `${routeModel(tags)}.publish`;
  return (CONFIRM_ACTIONS as readonly string[]).includes(action)
    ? (action as ConfirmAction)
    : null;
}
