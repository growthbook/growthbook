import { ApiKeyInterface } from "shared/types/apikey";
import { MemberRoleWithProjects } from "shared/types/organization";
import { ConfirmRule } from "shared/validators";
import {
  mergeConfirmRules,
  presetOf as confirmPresetOf,
  RECOMMENDED,
} from "./confirmRulesUtils";

// Who a credential's requests act as: an org key as itself or as the member it
// names, or a personal token (OAuth tokens included) as its owner.
export type Holder = "system" | "user" | "pat";
export type Preset = "readonly" | "hitl" | "full";

export type PermissionsValue = {
  // Kept while customizing, so going back to the presets restores it.
  preset: Preset | null;
  customizing: boolean;
  scope: MemberRoleWithProjects;
  requireConfirmation: boolean;
  rules: ConfirmRule[];
};

const RECOMMENDED_RULES: ConfirmRule[] = [{ actions: [RECOMMENDED] }];

// A System key has no one to hold a request for, so Human-in-the-Loop is
// only under Customize there.
export const presetsFor = (holder: Holder): Preset[] =>
  holder === "system" ? ["readonly", "full"] : ["readonly", "hitl", "full"];

// What a preset grants, in the custom form's terms. An admin cap on anything
// that acts as a user leaves that user's own permissions.
export function presetValue(
  preset: Preset,
): Pick<PermissionsValue, "scope" | "requireConfirmation" | "rules"> {
  return {
    scope: {
      role: preset === "readonly" ? "readonly" : "admin",
      limitAccessByEnvironment: false,
      environments: [],
    },
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

export function initialPermissions(
  key: SavedKey | undefined,
  holder: Holder,
): PermissionsValue {
  if (!key) {
    return {
      preset: holder === "system" ? null : "hitl",
      customizing: false,
      ...presetValue("readonly"),
    };
  }
  const preset = presetOfKey(key, holder);
  return {
    preset,
    customizing: !preset,
    scope: {
      role: holder === "pat" && !key.scoped ? "admin" : key.role || "admin",
      limitAccessByEnvironment: key.limitAccessByEnvironment ?? false,
      environments: key.environments ?? [],
      additionalRoles: key.additionalRoles,
      projectRoles: key.projectRoles,
    },
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
): PermissionsValue {
  if (value.customizing) return value;
  if (value.preset && !presetsFor(holder).includes(value.preset)) {
    return { ...value, preset: null };
  }
  if (!value.preset && holder !== "system") return { ...value, preset: "hitl" };
  return value;
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

function resolved(value: PermissionsValue) {
  const { scope, requireConfirmation, rules } =
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
    confirmRules: requireConfirmation ? mergeConfirmRules(rules) : null,
  };
}

// What an org key saves: its role (the cap on a member it acts as) and rules.
export function orgKeyFields(value: PermissionsValue) {
  const { role, scope, confirmRules } = resolved(value);
  return { role, ...scope, confirmRules };
}

// An admin cap with nothing narrowed leaves a person all of their own access.
export const isUnlimited = (scope: MemberRoleWithProjects) =>
  scope.role === "admin" &&
  !scope.limitAccessByEnvironment &&
  !scope.additionalRoles?.length &&
  !scope.projectRoles?.length;

// What a personal token saves. Unlimited, it acts as its user, so it stays
// unscoped rather than losing super-admin rights.
export function tokenFields(value: PermissionsValue) {
  const { role, scope, confirmRules } = resolved(value);
  return {
    ...(!isUnlimited({ role, ...scope }) && { scopedRole: role, ...scope }),
    confirmRules,
  };
}
