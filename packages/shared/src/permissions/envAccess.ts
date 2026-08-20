import {
  MemberRoleInfo,
  OrganizationInterface,
} from "../../types/organization";
import {
  EffectiveRoleSource,
  envScopedPermissionsForRole,
  getEffectiveRolesForProject,
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

/**
 * What a role actually lets you do in an environment it covers. Empty for roles
 * that answer the environment question some other way, admins included.
 */
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

/**
 * Additional rules grant alongside the base role, so access is the union: one
 * rule allowing the environment is enough, and the answer is only "not
 * applicable" when no rule is environment-scoped at all.
 */
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

type EnvAccessPrincipal = MemberRoleInfo & {
  projectRoles?: (MemberRoleInfo & { project: string })[];
};

type EnvAccessTeam = Parameters<typeof getEffectiveRolesForProject>[2][number];

export type EnvAccessSource = EffectiveRoleSource & {
  access: "yes" | "no" | "N/A";
};

export type EnvAccess = {
  access: "yes" | "no" | "N/A";
  outsideProject: boolean;
  sources: EnvAccessSource[];
};

const sourceKey = (s: EffectiveRoleSource) =>
  [
    s.sourceType,
    s.sourceName,
    s.role,
    s.limitAccessByEnvironment,
    s.environments.join(","),
  ].join("|");

// Every project someone wrote a rule for, so the all-projects view still sees
// access that only a project override grants.
function projectsWithRules(
  principal: EnvAccessPrincipal,
  teams: EnvAccessTeam[],
): string[] {
  const own = (principal.projectRoles ?? []).map((r) => r.project);
  const fromTeams = (principal.teams ?? []).flatMap((teamId) =>
    (teams.find((t) => t.id === teamId)?.projectRoles ?? []).map(
      (r) => r.project,
    ),
  );
  return [...new Set([...own, ...fromTeams])];
}

/**
 * Resolves effective environment access for one project or across all projects,
 * keeping the rule behind each answer. Shares `getEffectiveRolesForProject` with
 * the Role column so the two can't disagree about which roles apply.
 */
export function memberEnvAccess(
  principal: EnvAccessPrincipal,
  environment: { id: string; projects?: string[] },
  org: Partial<OrganizationInterface>,
  project: string,
  teams: EnvAccessTeam[] = [],
): EnvAccess {
  const envProjects = environment.projects?.length
    ? environment.projects
    : null;

  const contributing: EffectiveRoleSource[] = [];
  if (project) {
    if (envProjects && !envProjects.includes(project)) {
      return { access: "N/A", outsideProject: true, sources: [] };
    }
    contributing.push(
      ...getEffectiveRolesForProject(principal, project, teams),
    );
  } else {
    contributing.push(...getEffectiveRolesForProject(principal, null, teams));
    projectsWithRules(principal, teams).forEach((p) => {
      if (!envProjects || envProjects.includes(p)) {
        contributing.push(...getEffectiveRolesForProject(principal, p, teams));
      }
    });
  }

  const seen = new Set<string>();
  const sources: EnvAccessSource[] = [];
  contributing.forEach((s) => {
    const key = sourceKey(s);
    if (seen.has(key)) return;
    seen.add(key);
    sources.push({ ...s, access: ruleHasAccessToEnv(s, environment.id, org) });
  });

  const access = sources.some((s) => s.access === "yes")
    ? "yes"
    : sources.some((s) => s.access === "no")
      ? "no"
      : "N/A";

  return { access, outsideProject: false, sources };
}
