import type {
  Member,
  OrganizationInterface,
  ProjectMemberRole,
  Role,
} from "shared/types/organization";
import type { RoleSourceTeam } from "shared/permissions";
import { Permissions } from "shared/permissions";
import { getUserPermissions } from "back-end/src/util/organization.util";

/**
 * A generated persona grid: every combination of base role, base environment
 * limit, an additional rule, a team grant, and a project override. The
 * reference resolver below re-derives authority from first principles, so the
 * production resolvers are checked against an independent spelling of the
 * spec rather than against themselves.
 */

export const GRID_ENVS = ["dev", "production", "restricted"] as const;
export const GRID_PROJECTS = ["prj_a", "prj_b"] as const;

// The atoms under test, and which grid role grants which.
export const GRID_ATOMS = [
  "reviewFeatures",
  "publishFeatures",
  "editFeatureDrafts",
] as const;
export type GridAtom = (typeof GRID_ATOMS)[number];

const ROLE_ATOMS: Record<string, GridAtom[]> = {
  g_reviewer: ["reviewFeatures"],
  g_publisher: ["publishFeatures"],
  g_editor: ["editFeatureDrafts", "publishFeatures"],
  readonly: [],
};

// Whether the atom is environment-scoped (publish/review) or project-scoped
// (draft). Mirrors REVISION_PERMISSIONS by hand — the point of a reference.
export const ENV_SCOPED: Record<GridAtom, boolean> = {
  reviewFeatures: true,
  publishFeatures: true,
  editFeatureDrafts: false,
};

const GRID_ROLES: Role[] = [
  { id: "g_reviewer", description: "", policies: ["ReadData", "FlagsReview"] },
  {
    id: "g_publisher",
    description: "",
    policies: ["ReadData", "FlagsPublish"],
  },
  {
    id: "g_editor",
    description: "",
    policies: ["ReadData", "FlagsEditDrafts", "FlagsPublish"],
  },
] as unknown as Role[];

type Rule = {
  role: string;
  limitAccessByEnvironment: boolean;
  environments: string[];
};

const rule = (role: string, envs?: string[]): Rule => ({
  role,
  limitAccessByEnvironment: !!envs,
  environments: envs ?? [],
});

// ---- the five axes -------------------------------------------------------

const BASES = ["g_reviewer", "g_publisher", "g_editor", "readonly"] as const;
const BASE_LIMITS = [undefined, ["dev"]] as const;
const ADDITIONALS = [undefined, rule("g_publisher", ["production"])] as const;

export const GRID_TEAMS: (RoleSourceTeam & { name: string })[] = [
  {
    id: "t_reviewers",
    name: "Reviewers",
    role: "g_reviewer",
    limitAccessByEnvironment: false,
    environments: [],
  },
  {
    id: "t_publishers",
    name: "Publishers",
    role: "g_publisher",
    limitAccessByEnvironment: false,
    environments: [],
    additionalRoles: [rule("g_reviewer", ["production"])],
    // A team-side project override, so team overrides join the fold too.
    projectRoles: [
      { project: "prj_b", ...rule("g_reviewer", ["dev"]) },
    ] as ProjectMemberRole[],
  },
];
const TEAM_CHOICES = [undefined, "t_reviewers", "t_publishers"] as const;

const PROJECT_ROLE_CHOICES: (ProjectMemberRole | undefined)[] = [
  undefined,
  { project: "prj_a", ...rule("g_editor") } as ProjectMemberRole,
  {
    project: "prj_a",
    ...rule("g_reviewer", ["dev"]),
    additionalRoles: [rule("g_publisher", ["production"])],
  } as ProjectMemberRole,
];

export type GridPersona = {
  id: string;
  member: Member;
};

export function buildGridPersonas(): GridPersona[] {
  const personas: GridPersona[] = [];
  let n = 0;
  for (const base of BASES) {
    for (const baseLimit of BASE_LIMITS) {
      for (const additional of ADDITIONALS) {
        for (const team of TEAM_CHOICES) {
          for (const projectRole of PROJECT_ROLE_CHOICES) {
            const id = `u_grid_${n++}`;
            personas.push({
              id,
              member: {
                id,
                role: base,
                limitAccessByEnvironment: !!baseLimit,
                environments: baseLimit ?? [],
                ...(additional ? { additionalRoles: [additional] } : {}),
                ...(team ? { teams: [team] } : {}),
                ...(projectRole ? { projectRoles: [projectRole] } : {}),
              } as Member,
            });
          }
        }
      }
    }
  }
  return personas;
}

export function buildGridOrg(personas: GridPersona[]): OrganizationInterface {
  return {
    id: "org_grid",
    name: "Permutation Grid",
    ownerEmail: "test@test.com",
    url: "",
    dateCreated: new Date(),
    customRoles: GRID_ROLES,
    members: personas.map((p) => p.member),
    settings: {
      environments: [
        { id: "dev", description: "" },
        { id: "production", description: "" },
        // Only serves prj_b — exercises feature applicability, not authority.
        { id: "restricted", description: "", projects: ["prj_b"] },
      ],
    },
  } as unknown as OrganizationInterface;
}

// The endpoint pipeline: the same resolution a request context performs
// (member looked up on the org, teams folded in) without booting models.
export function endpointPermissions(
  org: OrganizationInterface,
  persona: GridPersona,
): Permissions {
  return new Permissions(
    getUserPermissions(
      { id: persona.id, email: "", verified: true },
      org,
      GRID_TEAMS as never,
    ),
  );
}

// ---- the reference resolver ------------------------------------------------
// Written from the documented precedence, not from the production code: an
// explicit project rule — from the member or any team — replaces global rules
// for that project; sources without one contribute nothing there; additional
// rules ride with whichever rule they sit on; authority is the union.

function contributingRules(
  member: Member,
  project: string | undefined,
): Rule[] {
  const sources: {
    global: Rule & { additionalRoles?: Rule[] };
    projectRoles?: ProjectMemberRole[];
  }[] = [
    {
      global: {
        role: member.role,
        limitAccessByEnvironment: member.limitAccessByEnvironment,
        environments: member.environments,
        additionalRoles: member.additionalRoles,
      },
      projectRoles: member.projectRoles,
    },
    ...(member.teams ?? []).map((teamId) => {
      const team = GRID_TEAMS.find((t) => t.id === teamId);
      if (!team) throw new Error(`unknown team ${teamId}`);
      return {
        global: {
          role: team.role,
          limitAccessByEnvironment: team.limitAccessByEnvironment,
          environments: team.environments,
          additionalRoles: team.additionalRoles as Rule[] | undefined,
        },
        projectRoles: team.projectRoles,
      };
    }),
  ];

  const withExtras = (r: Rule & { additionalRoles?: Rule[] }): Rule[] => [
    r,
    ...(r.additionalRoles ?? []),
  ];

  const explicit = sources.flatMap((s) => {
    const override = project
      ? s.projectRoles?.find((pr) => pr.project === project)
      : undefined;
    return override
      ? withExtras(override as Rule & { additionalRoles?: Rule[] })
      : [];
  });
  if (explicit.length) return explicit;
  return sources.flatMap((s) => withExtras(s.global));
}

export function referenceHasAtom(
  member: Member,
  atom: GridAtom,
  project: string | undefined,
  env: string | undefined,
): boolean {
  return contributingRules(member, project).some((r) => {
    if (!ROLE_ATOMS[r.role]?.includes(atom)) return false;
    if (!ENV_SCOPED[atom] || env === undefined) return true;
    if (!r.limitAccessByEnvironment) return true;
    return r.environments.includes(env);
  });
}

export function referenceHasUnrestricted(
  member: Member,
  atom: GridAtom,
  project: string | undefined,
): boolean {
  return contributingRules(member, project).some(
    (r) => ROLE_ATOMS[r.role]?.includes(atom) && !r.limitAccessByEnvironment,
  );
}
