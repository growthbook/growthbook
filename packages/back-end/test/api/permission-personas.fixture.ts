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
  // Participation without authority. The comment atom is org-wide rather than
  // part of either family, so this persona holds no Flags/SavedGroups policy at
  // all — which is the point: every operation but commenting must refuse it.
  commenter: ["Comments"],
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

/**
 * Which personas each revision operation admits — the permission model's expected
 * behaviour for the operations themselves, as data.
 *
 * Two test files read it, and that is the point. `permission-matrix-revision-entities`
 * drives the real endpoints against it; `permission-prediction-parity` holds the
 * control-side predictions to the same entries. Neither owns the oracle, so a rule
 * change has to move one table and both checks follow.
 */
export const OPERATION_ORACLE: Record<string, Persona[]> = {
  create: ["creator", "creatorPublisher", "full"],
  "open a draft": ["drafter", "editor", "full"],
  "edit a draft opened by someone else": ["drafter", "editor", "full"],
  "request review on a draft": ["drafter", "editor", "full"],
  "land a change directly": ["editor", "full"],
  archive: ["deleter", "full"],
  "publish a draft": ["publisher", "creatorPublisher", "editor", "full"],
  "submit a review verdict": ["reviewer", "full"],
  "discard a draft": ["drafter", "editor", "full"],
  "rebase a draft whose base has moved": ["drafter", "editor", "full"],
  "stage a revert as a draft": ["drafter", "reverter", "editor", "full"],
  "revert straight to published": ["reverter", "full"],

  // Unarchiving returns the entity to service, so it is an ordinary publish and
  // NOT the delete atom that took it out. A deleter holding the way back would
  // own a round trip it was never granted.
  unarchive: ["publisher", "creatorPublisher", "editor", "full"],

  // Commenting is participation, not a verdict. The comment atom reaches it, and
  // so does anyone who could rule on the draft or manage drafts generally. A
  // publisher, reverter or deleter holds none of those: authority to land a
  // change is not authority to speak in someone else's review.
  "comment on a draft": ["commenter", "drafter", "reviewer", "editor", "full"],

  // Staging publishes nothing, so the delete atom opens its own archive draft —
  // it must not take MORE authority to propose an archive than to land one.
  "stage an archive in a new draft": ["drafter", "deleter", "editor", "full"],
  // That exception is directional, mirroring `unarchive`. Staging the way back
  // is not delete-class, so the delete atom stops here.
  "stage an unarchive in a new draft": ["drafter", "editor", "full"],
  // ...and it does not reach SIDEWAYS either. Writing `archived` into a draft
  // someone else authored makes their draft delete-class, which locks its author
  // out of publishing their own work — so this one asks for draft authority or
  // authorship, whichever direction is being staged.
  "stage an archive into another author's draft": ["drafter", "editor", "full"],

  // A narrow atom may ADVANCE a draft that does only what the atom covers, so a
  // deleter can move an archive-only draft toward review — including one it did
  // not write, since it could publish that draft either way.
  "request review on an archive-only draft": [
    "drafter",
    "deleter",
    "editor",
    "full",
  ],
  // It may NOT destroy one. Discarding is draft authority or authorship, whatever
  // the draft happens to contain. `discard a draft` cannot see this rule: its
  // draft is a value edit, which refuses a deleter for the ordinary reason and
  // would go on passing if discard were content-aware again.
  "discard an archive-only draft": ["drafter", "editor", "full"],

  // The lifecycle verbs. All four are draft-or-review authority over a revision
  // that is already someone's work — none of them publishes anything, so no
  // environment footprint applies. Their handlers share one implementation
  // (`revisionLifecycle`), and these rows are what keeps that true per entity.
  //
  // Recall and reopen also admit the AUTHOR, but the matrix seeds every revision
  // as admin, so authorship is never what carries these.
  "recall a review request": ["drafter", "editor", "full"],
  "reopen a discarded revision": ["drafter", "editor", "full"],
  "retract your own review verdict": ["reviewer", "full"],
  // Arming a deferred publish takes the authority the fire-time publish will.
  "schedule a deferred publish": [
    "publisher",
    "creatorPublisher",
    "editor",
    "full",
  ],
};

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
