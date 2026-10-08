import {
  MemberRoleWithProjects,
  OrganizationInterface,
} from "shared/types/organization";
import {
  ENV_SCOPED_PERMISSIONS,
  getRoleById,
  permissionsFromRole,
} from "shared/permissions";

export type TeamRuleSource = {
  id: string;
  name: string;
  role: string;
  limitAccessByEnvironment: boolean;
  environments: string[];
  projectRoles?: {
    project: string;
    role: string;
    limitAccessByEnvironment: boolean;
    environments: string[];
  }[];
};

export type RoleRule = {
  key: string;
  role: string;
  project: string;
  environments: string[];
  limitAccessByEnvironment: boolean;
  source: "direct" | "team";
  teamName?: string;
  isPrimary?: boolean;
};

export const ALL_PROJECTS = "";

// Keys must be derived from position, not generated. A fresh key on every edit
// remounts the row and throws away its inline editing state.
export function toRules(
  value: MemberRoleWithProjects,
  teams: TeamRuleSource[] = [],
): RoleRule[] {
  const rules: RoleRule[] = [
    {
      key: "global",
      role: value.role,
      project: ALL_PROJECTS,
      environments: value.environments || [],
      limitAccessByEnvironment: !!value.limitAccessByEnvironment,
      source: "direct",
      isPrimary: true,
    },
    ...(value.additionalRoles || []).map((r, i) => ({
      key: `global:${i}`,
      role: r.role,
      project: ALL_PROJECTS,
      environments: r.environments || [],
      limitAccessByEnvironment: !!r.limitAccessByEnvironment,
      source: "direct" as const,
    })),
    ...(value.projectRoles || []).flatMap((pr, p) => [
      {
        key: `project:${p}`,
        role: pr.role,
        project: pr.project,
        environments: pr.environments || [],
        limitAccessByEnvironment: !!pr.limitAccessByEnvironment,
        source: "direct" as const,
      },
      ...(pr.additionalRoles || []).map((r, i) => ({
        key: `project:${p}:${i}`,
        role: r.role,
        project: pr.project,
        environments: r.environments || [],
        limitAccessByEnvironment: !!r.limitAccessByEnvironment,
        source: "direct" as const,
      })),
    ]),
  ];

  teams.forEach((team) => {
    rules.push({
      key: `team:${team.id}`,
      role: team.role,
      project: ALL_PROJECTS,
      environments: team.environments || [],
      limitAccessByEnvironment: !!team.limitAccessByEnvironment,
      source: "team",
      teamName: team.name,
    });
    (team.projectRoles || []).forEach((pr, p) => {
      rules.push({
        key: `team:${team.id}:${p}`,
        role: pr.role,
        project: pr.project,
        environments: pr.environments || [],
        limitAccessByEnvironment: !!pr.limitAccessByEnvironment,
        source: "team",
        teamName: team.name,
      });
    });
  });

  return rules;
}

export function fromRules(
  rules: RoleRule[],
  base: MemberRoleWithProjects,
): MemberRoleWithProjects {
  const direct = rules.filter((r) => r.source === "direct");
  const primary = direct.find((r) => r.isPrimary) ?? direct[0];
  const globals = direct.filter(
    (r) => r.project === ALL_PROJECTS && r !== primary,
  );

  const byProject = new Map<string, RoleRule[]>();
  direct
    .filter((r) => r.project !== ALL_PROJECTS)
    .forEach((r) => {
      byProject.set(r.project, [...(byProject.get(r.project) || []), r]);
    });

  return {
    ...base,
    role: primary?.role ?? base.role,
    environments: primary?.environments ?? [],
    limitAccessByEnvironment: !!primary?.limitAccessByEnvironment,
    additionalRoles: globals.map((r) => ({
      role: r.role,
      environments: r.environments,
      limitAccessByEnvironment: r.limitAccessByEnvironment,
    })),
    projectRoles: [...byProject.entries()].map(
      ([project, [first, ...rest]]) => ({
        project,
        role: first.role,
        environments: first.environments,
        limitAccessByEnvironment: first.limitAccessByEnvironment,
        additionalRoles: rest.map((r) => ({
          role: r.role,
          environments: r.environments,
          limitAccessByEnvironment: r.limitAccessByEnvironment,
        })),
      }),
    ),
  };
}

// Permission -> the environments it applies in, or "all" when the permission
// is not environment-scoped.
type Coverage = Map<string, Set<string> | "all">;

function coverageOf(
  rule: RoleRule,
  org: Partial<OrganizationInterface>,
): Coverage {
  const role = getRoleById(rule.role, org);
  const permissions = role ? permissionsFromRole(role) : {};
  const coverage: Coverage = new Map();

  Object.entries(permissions).forEach(([permission, granted]) => {
    if (!granted) return;
    const envScoped = ENV_SCOPED_PERMISSIONS.includes(permission as never);
    coverage.set(
      permission,
      envScoped && rule.limitAccessByEnvironment
        ? new Set(rule.environments)
        : "all",
    );
  });

  return coverage;
}

function absorb(target: Coverage, addition: Coverage) {
  addition.forEach((envs, permission) => {
    const current = target.get(permission);
    if (current === "all" || envs === "all") {
      target.set(permission, "all");
      return;
    }
    target.set(permission, new Set([...(current ?? []), ...envs]));
  });
}

function covers(outer: Coverage, inner: Coverage): boolean {
  return [...inner].every(([permission, envs]) => {
    const available = outer.get(permission);
    if (!available) return false;
    if (available === "all") return true;
    if (envs === "all") return false;
    return [...envs].every((env) => available.has(env));
  });
}

// Rules that change nothing, and why: they grant nothing, or another rule at
// the same scope already grants everything they do.
export function inertRules(
  rules: RoleRule[],
  org: Partial<OrganizationInterface>,
): Map<string, "empty" | "rules" | "teams"> {
  const inert = new Map<string, "empty" | "rules" | "teams">();

  const byScope = new Map<string, RoleRule[]>();
  rules.forEach((r) =>
    byScope.set(r.project, [...(byScope.get(r.project) || []), r]),
  );

  byScope.forEach((scoped) => {
    if (scoped.length < 2) return;
    scoped.forEach((rule, i) => {
      const own = coverageOf(rule, org);
      if (!own.size) {
        inert.set(rule.key, "empty");
        return;
      }

      const others: Coverage = new Map();
      const directOnly: Coverage = new Map();
      scoped.forEach((other, j) => {
        if (j === i || (j < i && inert.has(other.key))) return;
        const coverage = coverageOf(other, org);
        absorb(others, coverage);
        if (other.source === "direct") absorb(directOnly, coverage);
      });

      if (!covers(others, own)) return;
      inert.set(rule.key, covers(directOnly, own) ? "rules" : "teams");
    });
  });

  return inert;
}

export function newRule(): RoleRule {
  return {
    key: "new",
    role: "readonly",
    project: ALL_PROJECTS,
    environments: [],
    limitAccessByEnvironment: false,
    source: "direct",
  };
}
