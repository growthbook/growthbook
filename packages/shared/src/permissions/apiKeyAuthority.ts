import { isEqual, sortBy } from "lodash";
import { ApiKeyInterface } from "shared/types/apikey";
import type {
  MemberRoleInfo,
  OrganizationInterface,
  Permission,
} from "shared/types/organization";
import type { Permissions } from "./permissionsClass";
import {
  getRoleById,
  permissionsFromRole,
  roleSupportsEnvLimitFromRole,
} from "./permissions.utils";

// Whether toggling a PAT's `disabled` needs permission over members' tokens rather than the owner's own rights.
export function apiKeyToggleRequiresAdmin(
  key: Pick<ApiKeyInterface, "userId" | "disabled" | "disabledBy">,
  actorId: string,
): boolean {
  if (!key.userId) return false;
  // Another member's PAT, or one an admin disabled: the owner can't take over `disabledBy`.
  return (
    key.userId !== actorId ||
    (!!key.disabled && !!key.disabledBy && key.disabledBy !== actorId)
  );
}

// Who may set a secret key's `disabled`. Mirrors ApiKeyModel.canUpdate, so the UI
// and server agree. On an org key, disabling only takes access away, so it needs
// delete; enabling restores it, so it needs edit.
export function canSetApiKeyDisabled(
  permissions: Pick<
    Permissions,
    "canDeleteApiKey" | "canUpdateApiKey" | "canManagePersonalAccessTokens"
  >,
  key: Pick<ApiKeyInterface, "userId" | "disabled" | "disabledBy">,
  actorId: string,
  disabled: boolean,
): boolean {
  if (key.userId) {
    return (
      !apiKeyToggleRequiresAdmin(key, actorId) ||
      permissions.canManagePersonalAccessTokens()
    );
  }
  return disabled
    ? permissions.canDeleteApiKey()
    : permissions.canUpdateApiKey();
}

// Who may reveal or rotate a key's secret: the owner for a PAT, key creators for an org key.
export function canManageApiKeySecret(
  permissions: Pick<Permissions, "canCreateApiKey">,
  key: Pick<ApiKeyInterface, "userId">,
  actorId: string,
): boolean {
  return key.userId ? key.userId === actorId : permissions.canCreateApiKey();
}

export function canApplyExpirationPolicy(
  permissions: Pick<
    Permissions,
    "canDeleteApiKey" | "canManagePersonalAccessTokens"
  >,
  kind: "pat" | "secret",
): boolean {
  return kind === "pat"
    ? permissions.canManagePersonalAccessTokens()
    : permissions.canDeleteApiKey();
}

// A User key must name a member with X-GrowthBook-Requested-By and acts as
// them; a System key keeps its own role and only records who asked.
export function actsAsUser(key: Pick<ApiKeyInterface, "actAs">): boolean {
  return key.actAs === "user";
}

type ApiKeyAuthority = Pick<
  ApiKeyInterface,
  | "role"
  | "limitAccessByEnvironment"
  | "environments"
  | "additionalRoles"
  | "projectRoles"
  | "actAs"
  | "confirmRules"
>;

type RoleRule = Pick<
  MemberRoleInfo,
  "role" | "limitAccessByEnvironment" | "environments"
>;

const ruleAuthority = (rule: RoleRule) => ({
  role: rule.role,
  limitAccessByEnvironment: rule.limitAccessByEnvironment,
  environments: [...rule.environments].sort(),
});
const rulesAuthority = (rules: RoleRule[] | undefined) =>
  sortBy((rules ?? []).map(ruleAuthority), (rule) => JSON.stringify(rule));

// What an org key can do, in a form where an edit that leaves it alone, or
// only reorders its lists, compares equal.
function authorityOf(key: ApiKeyAuthority) {
  return {
    role: key.role ?? null,
    environments: key.limitAccessByEnvironment
      ? [...(key.environments ?? [])].sort()
      : null,
    additionalRoles: rulesAuthority(key.additionalRoles),
    projectRoles: sortBy(
      (key.projectRoles ?? []).map((pr) => ({
        project: pr.project,
        ...ruleAuthority(pr),
        additionalRoles: rulesAuthority(pr.additionalRoles),
      })),
      "project",
    ),
    actAs: key.actAs ?? "system",
    confirmRules: key.confirmRules ?? null,
  };
}

// Whether an edit changes what an org key can do. Doing so can hand a key more
// than it had, so it takes permission to create keys, not just to edit them.
export function changesApiKeyAuthority(
  before: ApiKeyAuthority,
  after: ApiKeyAuthority,
): boolean {
  return !isEqual(authorityOf(before), authorityOf(after));
}

// Permissions a key must not get through the REST role endpoint, or it could
// grant itself or other keys more. Global ones are only read from org-wide
// roles, so Project rules may carry them; manageProjects is refused anywhere.
const ORG_WIDE_REFUSED: [Permission, string][] = [
  ["manageCustomRoles", "manage custom roles"],
  ["manageTeam", "manage members"],
  ["createApiKeys", "manage API keys"],
  ["editApiKeys", "manage API keys"],
  ["deleteApiKeys", "manage API keys"],
  ["managePersonalAccessTokens", "manage API keys"],
  ["organizationSettings", "change organization settings"],
];
const REFUSED_EVERYWHERE: [Permission, string][] = [
  ["manageProjects", "manage Projects"],
];

type ApiKeyRoles = Pick<
  ApiKeyInterface,
  | "role"
  | "limitAccessByEnvironment"
  | "environments"
  | "additionalRoles"
  | "projectRoles"
>;

// Why a role set can't be given to an org key over REST, or null if it can.
// Unknown roles pass here and fail the key's usual validation.
export function apiKeyRolesRefusal(
  roles: ApiKeyRoles,
  org: Partial<OrganizationInterface>,
): string | null {
  const rules: { rule: RoleRule; path: string; orgWide: boolean }[] = [
    {
      rule: {
        role: roles.role ?? "",
        limitAccessByEnvironment: roles.limitAccessByEnvironment,
        environments: roles.environments,
      },
      path: "role",
      orgWide: true,
    },
    ...(roles.additionalRoles ?? []).map((rule, i) => ({
      rule,
      path: `additionalRoles[${i}]`,
      orgWide: true,
    })),
    ...(roles.projectRoles ?? []).flatMap((pr, i) => [
      { rule: pr, path: `projectRoles[${i}]`, orgWide: false },
      ...(pr.additionalRoles ?? []).map((rule, j) => ({
        rule,
        path: `projectRoles[${i}].additionalRoles[${j}]`,
        orgWide: false,
      })),
    ]),
  ];

  for (const { rule, path, orgWide } of rules) {
    if (rule.role === "admin") {
      return `The admin role can't be given to an API key through this endpoint (${path}).`;
    }
    const role = getRoleById(rule.role, org);
    if (!role) continue;
    const permissions = permissionsFromRole(role);
    const refused = [
      ...(orgWide ? ORG_WIDE_REFUSED : []),
      ...REFUSED_EVERYWHERE,
    ].find(([permission]) => permissions[permission]);
    if (refused) {
      return `The ${rule.role} role can't be given to an API key through this endpoint, because it can ${refused[1]} (${path}).`;
    }
    if (rule.limitAccessByEnvironment && !roleSupportsEnvLimitFromRole(role)) {
      return `The ${rule.role} role can't be limited by environment, so limitAccessByEnvironment must be false (${path}).`;
    }
  }
  return null;
}
