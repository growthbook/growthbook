import {
  CONFIRM_MODEL_BY_TAG,
  type ConfirmAction,
  type ConfirmLabel,
  type ConfirmRule,
} from "../validators/confirmations";

// The actions any rule holds. A rule names a label, a whole category
// ("override.*") or everything ("*"); an action with no environments matches
// any environment list.
export function matchConfirmRules(
  rules: ConfirmRule[],
  actions: ConfirmAction[],
): ConfirmAction[] {
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

// The labels a route may hold for: its own, or `<model>.other` for a write to a
// live model that declares none.
export function routeConfirmation(
  method: string,
  tags: readonly string[] | undefined,
  declared: readonly ConfirmLabel[] | undefined,
): readonly ConfirmLabel[] {
  if (declared) return declared;
  if (method.toLowerCase() === "get") return [];
  const model = tags
    ?.map(
      (tag) => CONFIRM_MODEL_BY_TAG[tag as keyof typeof CONFIRM_MODEL_BY_TAG],
    )
    .find(Boolean);
  return model ? [`${model}.other`] : [];
}
