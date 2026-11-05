import { ApiKeyInterface } from "shared/types/apikey";
import { MemberRoleWithProjects } from "shared/types/organization";
import { ConfirmRule, OAuthTokenPermissions } from "shared/validators";
import {
  mergeConfirmRules,
  presetOf as confirmPresetOf,
  RECOMMENDED,
} from "./confirmRulesUtils";

// Who a credential's requests act as: an org key as itself or as the member it
// names, or a personal token (OAuth tokens included) as its owner.
export type Holder = "system" | "user" | "pat";
export type Preset = "readonly" | "hitl" | "full";

// What the org's plan and roles let a credential use.
export type Allowed = {
  // Any role but admin.
  roles: boolean;
  // The Read only role, which an org can also deactivate.
  readonly: boolean;
  // Human-in-the-Loop confirmations.
  confirmations: boolean;
};

export type PermissionsValue = {
  // Kept while customizing, so going back to the presets restores it.
  preset: Preset | null;
  customizing: boolean;
  scope: MemberRoleWithProjects;
  // Whether the role narrows the person a token or User key acts as. A
  // token's `scoped`, which drops super-admin rights even at admin.
  restricted: boolean;
  requireConfirmation: boolean;
  rules: ConfirmRule[];
};

export const PRESET_LABELS: Record<Preset, string> = {
  readonly: "Read only",
  hitl: "Human-in-the-Loop",
  full: "Full access",
};

const RECOMMENDED_RULES: ConfirmRule[] = [{ actions: [RECOMMENDED] }];

// A System key has no one to hold a request for, so Human-in-the-Loop is
// only under Customize there.
export const presetsFor = (holder: Holder): Preset[] =>
  holder === "system" ? ["readonly", "full"] : ["readonly", "hitl", "full"];

export const presetAllowed = (preset: Preset, allowed: Allowed) =>
  preset === "full" ||
  (preset === "readonly" ? allowed.readonly : allowed.confirmations);

// Without roles or confirmations there is nothing to customize.
export const canCustomize = (allowed: Allowed) =>
  allowed.roles || allowed.confirmations;

// Human-in-the-Loop when it's offered, the only choice when there's one,
// otherwise nothing so the choice is deliberate.
function defaultPreset(holder: Holder, allowed: Allowed): Preset | null {
  const options = presetsFor(holder).filter((p) => presetAllowed(p, allowed));
  if (options.length === 1) return options[0];
  return options.includes("hitl") ? "hitl" : null;
}

// What a preset grants, in the custom form's terms. An admin cap on anything
// that acts as a user leaves that user's own permissions.
export function presetValue(
  preset: Preset,
): Pick<
  PermissionsValue,
  "scope" | "restricted" | "requireConfirmation" | "rules"
> {
  return {
    scope: {
      role: preset === "readonly" ? "readonly" : "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
    restricted: preset === "readonly",
    requireConfirmation: preset === "hitl",
    rules: RECOMMENDED_RULES,
  };
}

type SavedKey = Pick<
  ApiKeyInterface,
  | "role"
  | "scoped"
  | "limitAccessByEnvironment"
  | "environments"
  | "additionalRoles"
  | "projectRoles"
  | "confirmRules"
>;

// The preset a saved key amounts to, or null when only the custom form can show it.
export function presetOfKey(key: SavedKey, holder: Holder): Preset | null {
  if (
    key.limitAccessByEnvironment ||
    key.additionalRoles?.length ||
    key.projectRoles?.length
  ) {
    return null;
  }
  const role = holder === "pat" && !key.scoped ? "admin" : key.role || "admin";
  // A scoped token stays scoped until its owner lifts it, even at admin.
  if (holder === "pat" && key.scoped && role === "admin") return null;
  const preset: Preset | null = !key.confirmRules
    ? role === "readonly"
      ? "readonly"
      : role === "admin"
        ? "full"
        : null
    : role === "admin" &&
        confirmPresetOf(mergeConfirmRules(key.confirmRules)) === RECOMMENDED
      ? "hitl"
      : null;
  return preset && presetsFor(holder).includes(preset) ? preset : null;
}

// What a connected app was allowed on the consent page: its preset, or for
// custom permissions the role rules (when restricted) and whether it confirms.
// A grant from before consent asked acts as its user.
export function describeGrant(permissions: OAuthTokenPermissions | null) {
  const { scopedRole, ...rest } = permissions ?? {};
  const scope = {
    role: scopedRole || "admin",
    limitAccessByEnvironment: rest.limitAccessByEnvironment ?? false,
    environments: rest.environments ?? [],
    additionalRoles: rest.additionalRoles,
    projectRoles: rest.projectRoles,
  };
  return {
    preset: presetOfKey(
      { ...scope, scoped: !!scopedRole, confirmRules: rest.confirmRules },
      "pat",
    ),
    scope: scopedRole ? scope : null,
    confirmations: !!rest.confirmRules,
  };
}

export function initialPermissions(
  key: SavedKey | undefined,
  holder: Holder,
  allowed: Allowed,
): PermissionsValue {
  if (!key) {
    return {
      preset: defaultPreset(holder, allowed),
      customizing: false,
      // Where Customize starts when no preset is picked.
      ...presetValue(allowed.readonly ? "readonly" : "full"),
    };
  }
  const preset = presetOfKey(key, holder);
  const scope = {
    role: holder === "pat" && !key.scoped ? "admin" : key.role || "admin",
    limitAccessByEnvironment: key.limitAccessByEnvironment ?? false,
    environments: key.environments ?? [],
    additionalRoles: key.additionalRoles,
    projectRoles: key.projectRoles,
  };
  return {
    preset,
    customizing: !preset,
    scope,
    restricted: holder === "pat" ? !!key.scoped : !isUnlimited(scope),
    requireConfirmation: !!key.confirmRules,
    rules: key.confirmRules
      ? mergeConfirmRules(key.confirmRules)
      : RECOMMENDED_RULES,
  };
}

// Keeps the presets valid when an org key switches between System and User.
export function forHolder(
  value: PermissionsValue,
  holder: Holder,
  allowed: Allowed,
): PermissionsValue {
  // A System key's role table doesn't track `restricted`, so a User key reads
  // it off the role it would save.
  if (value.customizing) {
    return { ...value, restricted: !isUnlimited(value.scope) };
  }
  if (value.preset && presetsFor(holder).includes(value.preset)) return value;
  return { ...value, preset: defaultPreset(holder, allowed) };
}

// The custom form starts from the preset it replaces.
export function startCustomizing(value: PermissionsValue): PermissionsValue {
  return {
    ...value,
    ...(value.preset && presetValue(value.preset)),
    customizing: true,
  };
}

export const isComplete = (value: PermissionsValue) =>
  value.customizing || value.preset !== null;

// Why the custom form can't be saved yet, or null.
export const rulesProblem = (value: PermissionsValue) =>
  value.customizing &&
  value.requireConfirmation &&
  value.rules.some((rule) => !rule.actions.length)
    ? "Choose at least one action for each confirmation rule."
    : null;

function resolved(value: PermissionsValue) {
  const { scope, restricted, requireConfirmation, rules } =
    value.customizing || !value.preset
      ? value
      : { ...value, ...presetValue(value.preset) };
  return {
    role: scope.role,
    scope: {
      limitAccessByEnvironment: scope.limitAccessByEnvironment,
      environments: scope.environments,
      additionalRoles: scope.additionalRoles,
      projectRoles: scope.projectRoles,
    },
    restricted,
    confirmRules: requireConfirmation ? mergeConfirmRules(rules) : null,
  };
}

// What an org key saves: its role (the cap on a member it acts as) and rules.
export function orgKeyFields(value: PermissionsValue) {
  const { role, scope, confirmRules } = resolved(value);
  return { role, ...scope, confirmRules };
}

// An admin cap with nothing narrowed leaves a person all of their own access.
const isUnlimited = (scope: MemberRoleWithProjects) =>
  scope.role === "admin" &&
  !scope.limitAccessByEnvironment &&
  !scope.additionalRoles?.length &&
  !scope.projectRoles?.length;

// What a personal token saves. Unrestricted, it acts as its user, so it stays
// unscoped rather than losing super-admin rights.
export function tokenFields(value: PermissionsValue) {
  const { role, scope, restricted, confirmRules } = resolved(value);
  return {
    ...(restricted && { scopedRole: role, ...scope }),
    confirmRules,
  };
}
