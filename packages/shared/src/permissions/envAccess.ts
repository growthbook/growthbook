import {
  MemberRoleInfo,
  OrganizationInterface,
} from "../../types/organization";
import {
  envScopedPermissionsForRole,
  roleSupportsEnvLimit,
} from "./permissions.utils";
import { REVISION_PERMISSIONS, RevisionAction } from "./revisionPermissions";

// The env-scoped atoms that aren't revision actions get spelled out; the rest
// reuse the revision action names.
const OTHER_ENV_ACTION_LABELS: Record<string, string> = {
  manageEnvironments: "manage environments",
  manageSDKConnections: "manage SDK connections",
  manageSDKWebhooks: "manage SDK webhooks",
  runExperiments: "run experiments",
};

const ACTION_ORDER: RevisionAction[] = [
  "create",
  "publish",
  "revert",
  "review",
  "delete",
];

const ACTION_BY_PERMISSION = new Map<string, RevisionAction>();
Object.values(REVISION_PERMISSIONS).forEach((actions) =>
  Object.entries(actions).forEach(([action, { permission, scope }]) => {
    if (scope === "environment") {
      ACTION_BY_PERMISSION.set(permission, action as RevisionAction);
    }
  }),
);

// What a role lets you do in an environment it covers. Empty for roles that
// answer the environment question some other way, admins included.
export function envScopeLabels(
  roleId: string,
  org: Partial<OrganizationInterface>,
): string[] {
  const actions = new Set<string>();
  const others = new Set<string>();
  envScopedPermissionsForRole(roleId, org).forEach((p) => {
    const action = ACTION_BY_PERMISSION.get(p);
    if (action) {
      actions.add(action);
    } else if (OTHER_ENV_ACTION_LABELS[p]) {
      others.add(OTHER_ENV_ACTION_LABELS[p]);
    }
  });
  return [...ACTION_ORDER.filter((a) => actions.has(a)), ...[...others].sort()];
}

function ruleHasAccessToEnv(
  rule: {
    role: string;
    limitAccessByEnvironment: boolean;
    environments: string[];
  },
  env: string,
  org: Partial<OrganizationInterface>,
): "yes" | "no" | "N/A" {
  if (rule.role === "admin" || rule.role === "gbDefault_projectAdmin") {
    return "yes";
  }

  if (!roleSupportsEnvLimit(rule.role, org)) return "N/A";

  if (!rule.limitAccessByEnvironment) return "yes";

  if (rule.environments.includes(env)) return "yes";

  return "no";
}

// Access is the union across base and additional rules: one rule allowing the
// environment is enough, and "N/A" only when nothing is environment-scoped.
export function roleHasAccessToEnv(
  role: MemberRoleInfo,
  env: string,
  org: Partial<OrganizationInterface>,
): "yes" | "no" | "N/A" {
  const results = [role, ...(role.additionalRoles ?? [])].map((rule) =>
    ruleHasAccessToEnv(rule, env, org),
  );

  if (results.includes("yes")) return "yes";
  if (results.includes("no")) return "no";
  return "N/A";
}
