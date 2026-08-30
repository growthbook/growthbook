import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { RequireReview, TeamInterface } from "shared/types/organization";
import { assessRevisionApproval } from "back-end/src/services/featurePublishGates";
import { assertCanPublishFeatureRevision } from "back-end/src/revisions/featureDraftAuthority";
import type { Context } from "back-end/src/models/BaseModel";
import type { Member } from "./grid.fixture";
import {
  GRID_TEAMS,
  buildGridOrg,
  buildGridPersonas,
  endpointPermissions,
  referenceHasAtom,
} from "./grid.fixture";

// Approval settings decide whether review is REQUIRED (persona-independent);
// role limits decide who MAY act (settings-independent); what a user can do
// unaided is the composition.

// ---- settings: (a) approvals off, (b) on for some environments, on for all --

const on = (over: Partial<RequireReview> = {}): RequireReview => ({
  requireReviewOn: true,
  projects: [],
  ...over,
});

const SETTINGS: [string, RequireReview[]][] = [
  ["approvals off everywhere", []],
  ["approvals on everywhere", [on()]],
  ["approvals on production only", [on({ environments: ["production"] })]],
];

// ---- personas: the draft / publish / review action split, env-limited -------

const personas = buildGridPersonas();
const plain = (m: Member) => !m.additionalRoles && !m.teams && !m.projectRoles;
const pick = (predicate: (m: Member) => boolean, label: string) => {
  const p = personas.find((x) => predicate(x.member));
  if (!p) throw new Error(`no persona: ${label}`);
  return { label, ...p };
};

const ACTORS = [
  pick(
    (m) => m.role === "g_publisher" && !m.limitAccessByEnvironment && plain(m),
    "publisher unlimited",
  ),
  pick(
    (m) => m.role === "g_publisher" && m.environments[0] === "dev" && plain(m),
    "publisher dev-limited",
  ),
  pick(
    (m) => m.role === "g_editor" && m.environments[0] === "dev" && plain(m),
    "editor+publisher dev-limited",
  ),
  pick(
    (m) => m.role === "g_reviewer" && !m.limitAccessByEnvironment && plain(m),
    "reviewer only (no publish)",
  ),
  pick((m) => m.role === "readonly" && plain(m), "readonly"),
] as const;

// ---- changes: dev-only, production-only, global ------------------------------

const APPLICABLE_ENVS = ["dev", "production"];

const baseRevision = (over: Partial<FeatureRevisionInterface>) =>
  ({
    version: 2,
    status: "approved",
    rules: [],
    environmentsEnabled: { dev: true, production: true },
    defaultValue: "false",
    prerequisites: [],
    archived: false,
    metadata: {},
    holdout: null,
    rampActions: [],
    reviews: [],
    ...over,
  }) as unknown as FeatureRevisionInterface;

const CHANGES: {
  name: string;
  envs: string[];
  revision: () => FeatureRevisionInterface;
}[] = [
  {
    name: "dev-only change",
    envs: ["dev"],
    revision: () =>
      baseRevision({
        environmentsEnabled: { dev: false, production: true },
      } as Partial<FeatureRevisionInterface>),
  },
  {
    name: "production-only change",
    envs: ["production"],
    revision: () =>
      baseRevision({
        environmentsEnabled: { dev: true, production: false },
      } as Partial<FeatureRevisionInterface>),
  },
  {
    name: "global change (every environment)",
    envs: APPLICABLE_ENVS,
    revision: () =>
      baseRevision({
        defaultValue: "true",
      } as Partial<FeatureRevisionInterface>),
  },
];

// ---- references ---------------------------------------------------------------

const feature = { id: "f_grid", project: "" } as unknown as FeatureInterface;
const live = baseRevision({ version: 1, status: "published" });

function referenceRequiresReview(
  rules: RequireReview[],
  changeEnvs: string[],
): boolean {
  const rule = rules.find((r) => !r.projects.length);
  if (!rule?.requireReviewOn) return false;
  const gated = rule.environments ?? [];
  if (!gated.length) return true;
  return changeEnvs.some((e) => gated.includes(e));
}

function referenceCanPublish(member: Member, changeEnvs: string[]): boolean {
  return changeEnvs.every((e) =>
    referenceHasAtom(member, "publishFeatures", undefined, e),
  );
}

function contextFor(rules: RequireReview[], actor: (typeof ACTORS)[number]) {
  const org = buildGridOrg(personas);
  (org.settings as { requireReviews?: RequireReview[] }).requireReviews = rules;
  return {
    org,
    teams: GRID_TEAMS as unknown as TeamInterface[],
    hasPremiumFeature: () => true,
    permissions: endpointPermissions(org, actor),
    models: { rampSchedules: { getById: async () => null } },
  } as unknown as Context;
}

// ---- the sweep ------------------------------------------------------------------

describe.each(SETTINGS)("%s", (_settingName, rules) => {
  it.each(CHANGES.map((c) => [c.name, c] as const))(
    "%s: requirement is persona-independent, authority is settings-independent",
    async (_name, change) => {
      const disagreements: string[] = [];
      for (const actor of ACTORS) {
        const context = contextFor(rules, actor);
        const draft = change.revision();

        const assessment = await assessRevisionApproval({
          context,
          feature,
          revision: draft,
          effectiveRevision: draft,
          filledLive: live,
          base: live,
        });
        const expectedRequired = referenceRequiresReview(rules, change.envs);
        if (assessment.requiresReview !== expectedRequired) {
          disagreements.push(
            `${actor.label}: requiresReview=${assessment.requiresReview}, reference=${expectedRequired}`,
          );
        }

        // instanceof PermissionError fails under jest's mixed shared-module
        // copies, so match by name.
        const canPublish = await assertCanPublishFeatureRevision({
          context: context as never,
          feature,
          revision: draft,
          environments: change.envs,
        }).then(
          () => true,
          (e: Error) => {
            if (e?.name === "PermissionError") return false;
            throw e;
          },
        );
        const expectedPublish = referenceCanPublish(actor.member, change.envs);
        if (canPublish !== expectedPublish) {
          disagreements.push(
            `${actor.label}: canPublish=${canPublish}, reference=${expectedPublish}`,
          );
        }

        const landsUnaided = canPublish && !assessment.requiresReview;
        const expectedUnaided = expectedPublish && !expectedRequired;
        if (landsUnaided !== expectedUnaided) {
          disagreements.push(
            `${actor.label}: landsUnaided=${landsUnaided}, reference=${expectedUnaided}`,
          );
        }
      }
      expect(disagreements).toEqual([]);
    },
  );
});
