import type { Request } from "express";
import type { OrganizationInterface, Role } from "shared/types/organization";
import { ReqContextClass } from "back-end/src/services/context";

/**
 * The permission model's expected behaviour, as data.
 *
 * The oracle used to live as a prose table, which can't fail when the code
 * disagrees with it. Here it executes: each persona holds exactly the atoms
 * named, and the matrix tests drive real endpoints and diff the result against
 * `EXPECTED`.
 *
 * Every persona also holds `readData` — without it they can't see the entity at
 * all and every case would fail for the wrong reason.
 */

export const ENVS = ["dev", "production"] as const;

/**
 * One custom role per persona, carrying only the POLICIES under test — the same
 * grant mechanism an organization has. Composing from atoms would test a path
 * no admin can configure.
 */
export const PERSONAS = {
  drafter: ["FlagsEditDrafts", "SavedGroupsEditDrafts"],
  reviewer: ["FlagsReview", "SavedGroupsReview"],
  publisher: ["FlagsPublish", "SavedGroupsPublish"],
  reverter: ["FlagsRevert", "SavedGroupsRevert"],
  deleter: ["FlagsDelete", "SavedGroupsDelete"],
  creator: ["FlagsCreate", "SavedGroupsCreate"],
  // Creating a flag that enables an environment lands it in the payload, so
  // that case takes publish as well as create.
  creatorPublisher: [
    "FlagsCreate",
    "FlagsPublish",
    "SavedGroupsCreate",
    "SavedGroupsPublish",
  ],
  // The everyday editor: authors a change and lands it.
  editor: [
    "FlagsEditDrafts",
    "FlagsPublish",
    "SavedGroupsEditDrafts",
    "SavedGroupsPublish",
  ],
  // Everything except bypass, so approval requirements still apply.
  full: ["FlagsFullAccess", "SavedGroupsFullAccess"],
} as const;

export type Persona = keyof typeof PERSONAS;
export const PERSONA_IDS = Object.keys(PERSONAS) as Persona[];

/**
 * An env-limited twin of each persona, limited to `dev`. Anything env-scoped
 * (create, delete, review, publish, revert) must refuse a change whose footprint
 * reaches production; anything project-scoped (draft, bypass) must not care.
 */
export const DEV_ONLY_SUFFIX = "_dev";

function roleFor(persona: Persona, envLimited: boolean): Role {
  return {
    id: envLimited ? `${persona}${DEV_ONLY_SUFFIX}` : persona,
    description: `QA persona: ${persona}${envLimited ? " (dev only)" : ""}`,
    policies: ["ReadData", ...PERSONAS[persona]] as unknown as Role["policies"],
  };
}

export const CUSTOM_ROLES: Role[] = PERSONA_IDS.flatMap((p) => [
  roleFor(p, false),
  roleFor(p, true),
]);

export function buildOrg(orgId: string): OrganizationInterface {
  return {
    id: orgId,
    name: "Permission Matrix",
    ownerEmail: "test@test.com",
    url: "",
    dateCreated: new Date(),
    customRoles: CUSTOM_ROLES,
    members: [
      // An admin to build the world under test; personas only exercise gates.
      {
        id: "u_admin",
        role: "admin",
        limitAccessByEnvironment: false,
        environments: [],
      },
      ...PERSONA_IDS.flatMap((p) => [
        {
          id: `u_${p}`,
          role: p,
          limitAccessByEnvironment: false,
          environments: [],
        },
        {
          id: `u_${p}${DEV_ONLY_SUFFIX}`,
          role: `${p}${DEV_ONLY_SUFFIX}`,
          limitAccessByEnvironment: true,
          environments: ["dev"],
        },
      ]),
    ],
    settings: {
      environments: ENVS.map((id) => ({ id, description: "" })),
      // Saved groups reject an attributeKey the org doesn't declare.
      attributeSchema: [{ property: "userId", datatype: "string" }],
    },
  } as unknown as OrganizationInterface;
}

export function makePersonaContext(
  org: OrganizationInterface,
  role: string,
  userId: string,
) {
  const context = new ReqContextClass({
    org,
    auditUser: { type: "api_key", apiKey: `k_${role}` },
    user: {
      id: userId,
      email: `${userId}@test.com`,
      name: userId,
      superAdmin: false,
    },
    role,
    req: { query: {}, headers: {}, body: {} } as unknown as Request,
  });
  context.hasPremiumFeature = () => true;
  return context;
}
