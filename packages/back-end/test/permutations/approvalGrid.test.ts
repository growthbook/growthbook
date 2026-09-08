import type { FeatureInterface } from "shared/types/feature";
import type { FeatureRevisionInterface } from "shared/types/feature-revision";
import type { Member, RequireReview } from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import type { Context } from "back-end/src/models/BaseModel";
import { assessRevisionApproval } from "back-end/src/services/featurePublishGates";
import {
  buildGridOrg,
  buildGridPersonas,
  GRID_TEAMS,
  referenceHasAtom,
  referenceHasUnrestricted,
} from "./grid.fixture";

/**
 * Approval settings x feature scope x change shape x approver persona, judged
 * twice: by assessRevisionApproval (the gate every publish flow calls) and by
 * a reference that re-derives "which environments does this change affect,
 * does a rule gate them, and does this approval cover them" from the spec.
 */

// ---- settings permutations -------------------------------------------------

const on = (over: Partial<RequireReview> = {}): RequireReview => ({
  requireReviewOn: true,
  projects: [],
  ...over,
});

const SETTINGS: [string, RequireReview[]][] = [
  ["review off", []],
  ["review on everywhere", [on()]],
  ["review on production only", [on({ environments: ["production"] })]],
  [
    "review on with a required team",
    [on({ requiredApproverTeams: ["t_reviewers"] })],
  ],
  [
    "project override narrows prj_a to dev",
    [on(), on({ projects: ["prj_a"], environments: ["dev"] })],
  ],
];

// ---- feature scopes ----------------------------------------------------------

const FEATURES: FeatureInterface[] = [
  { id: "f_open", project: "" },
  { id: "f_a", project: "prj_a" },
  // prj_b makes the `restricted` environment applicable.
  { id: "f_b", project: "prj_b" },
] as unknown as FeatureInterface[];

const applicableEnvs = (feature: FeatureInterface): string[] =>
  ["dev", "production", "restricted"].filter(
    (env) => env !== "restricted" || feature.project === "prj_b",
  );

// ---- change shapes -----------------------------------------------------------

type Change = {
  name: string;
  // "EVERYWHERE" = a global change; otherwise the raw env reach before
  // intersecting with the feature's applicable set.
  reach: string[] | "EVERYWHERE";
  revision: (
    reviews: { userId: string; status: string }[],
  ) => Partial<FeatureRevisionInterface>;
};

const baseRevision = (over: Partial<FeatureRevisionInterface>) =>
  ({
    version: 2,
    status: "approved",
    rules: [],
    environmentsEnabled: { dev: true, production: true, restricted: true },
    defaultValue: "false",
    prerequisites: [],
    archived: false,
    metadata: {},
    holdout: null,
    rampActions: [],
    reviews: [],
    ...over,
  }) as unknown as FeatureRevisionInterface;

const CHANGES: Change[] = [
  {
    name: "production kill switch",
    reach: ["production"],
    revision: (reviews) =>
      baseRevision({
        environmentsEnabled: { dev: true, production: false, restricted: true },
        reviews,
      } as Partial<FeatureRevisionInterface>),
  },
  {
    name: "dev kill switch",
    reach: ["dev"],
    revision: (reviews) =>
      baseRevision({
        environmentsEnabled: { dev: false, production: true, restricted: true },
        reviews,
      } as Partial<FeatureRevisionInterface>),
  },
  {
    name: "global default value change",
    reach: "EVERYWHERE",
    revision: (reviews) =>
      baseRevision({
        defaultValue: "true",
        reviews,
      } as Partial<FeatureRevisionInterface>),
  },
  {
    name: "ramp update dropping production",
    reach: ["dev", "production"],
    revision: (reviews) =>
      baseRevision({
        reviews,
        rampActions: [
          {
            mode: "update",
            rampScheduleId: "rs_grid",
            ruleId: "r_missing",
            startActions: [],
            steps: [{ actions: [{ patch: { environments: ["dev"] } }] }],
            endActions: [],
          },
        ],
      } as unknown as Partial<FeatureRevisionInterface>),
  },
];

// The live schedule the ramp update replaces: its patches touch production.
const LIVE_SCHEDULE = {
  startActions: [],
  steps: [{ actions: [{ patch: { environments: ["production"] } }] }],
  endActions: [],
};

// ---- approver personas -------------------------------------------------------

const personas = buildGridPersonas();
const pick = (predicate: (m: Member) => boolean, label: string) => {
  const p = personas.find((x) => predicate(x.member));
  if (!p) throw new Error(`no persona: ${label}`);
  return { label, ...p };
};

const APPROVERS = [
  pick(
    (m) =>
      m.role === "g_reviewer" &&
      !m.limitAccessByEnvironment &&
      !m.additionalRoles &&
      !m.teams &&
      !m.projectRoles,
    "reviewer unlimited",
  ),
  pick(
    (m) =>
      m.role === "g_reviewer" &&
      m.environments[0] === "dev" &&
      !m.additionalRoles &&
      !m.teams &&
      !m.projectRoles,
    "reviewer dev-limited",
  ),
  pick(
    (m) =>
      m.role === "readonly" &&
      !m.additionalRoles &&
      m.teams?.[0] === "t_reviewers" &&
      !m.projectRoles,
    "review via team, unlimited",
  ),
  pick(
    (m) =>
      m.role === "readonly" &&
      !m.additionalRoles &&
      m.teams?.[0] === "t_publishers" &&
      !m.projectRoles,
    "review via team rule, production only",
  ),
  pick(
    (m) =>
      m.role === "readonly" &&
      !m.additionalRoles &&
      !m.teams &&
      m.projectRoles?.[0]?.role === "g_reviewer",
    "review via prj_a override, dev only",
  ),
  pick(
    (m) =>
      m.role === "g_publisher" &&
      !m.limitAccessByEnvironment &&
      !m.additionalRoles &&
      !m.teams &&
      !m.projectRoles,
    "publisher, no review at all",
  ),
] as const;

// ---- the reference -----------------------------------------------------------

function resolveRule(
  rules: RequireReview[],
  project: string,
): RequireReview | undefined {
  const specific = rules.find((r) => r.projects.includes(project));
  return specific ?? rules.find((r) => !r.projects.length);
}

function referenceRequiresReview(
  rules: RequireReview[],
  feature: FeatureInterface,
  change: Change,
): boolean {
  const rule = resolveRule(rules, feature.project ?? "");
  if (!rule?.requireReviewOn) return false;
  if (change.reach === "EVERYWHERE") return true;
  const affected = change.reach.filter((e) =>
    applicableEnvs(feature).includes(e),
  );
  if (!affected.length) return false;
  const gated = rule.environments ?? [];
  if (!gated.length) return true;
  return affected.some((e) => gated.includes(e));
}

function referenceCovers(
  member: Member,
  feature: FeatureInterface,
  change: Change,
): boolean {
  const project = feature.project || undefined;
  if (change.reach === "EVERYWHERE") {
    return referenceHasUnrestricted(member, "reviewFeatures", project);
  }
  const affected = change.reach.filter((e) =>
    applicableEnvs(feature).includes(e),
  );
  return affected.every((e) =>
    referenceHasAtom(member, "reviewFeatures", project, e),
  );
}

// ---- the sweep ---------------------------------------------------------------

const live = baseRevision({ version: 1, status: "published", reviews: [] });

function contextFor(rules: RequireReview[]): Context {
  const org = buildGridOrg(personas);
  (org.settings as { requireReviews?: RequireReview[] }).requireReviews = rules;
  return {
    org,
    teams: GRID_TEAMS as unknown as TeamInterface[],
    hasPremiumFeature: () => true,
    models: {
      rampSchedules: {
        getById: async (id: string) =>
          id === "rs_grid" ? LIVE_SCHEDULE : null,
      },
    },
  } as unknown as Context;
}

describe.each(SETTINGS)("%s", (settingName, rules) => {
  describe.each(FEATURES.map((f) => [f.project || "(no project)", f] as const))(
    "feature in %s",
    (_scope, feature) => {
      it.each(CHANGES.map((c) => [c.name, c] as const))(
        "%s: requirement and coverage match the reference for every approver",
        async (_name, change) => {
          const context = contextFor(rules);
          const disagreements: string[] = [];
          for (const approver of APPROVERS) {
            const draft = change.revision([
              { userId: approver.id, status: "approved" },
            ]) as FeatureRevisionInterface;
            const result = await assessRevisionApproval({
              context,
              feature,
              revision: draft,
              effectiveRevision: draft,
              filledLive: live,
              base: live,
            });

            const expectedRequired = referenceRequiresReview(
              rules,
              feature,
              change,
            );
            if (result.requiresReview !== expectedRequired) {
              disagreements.push(
                `${approver.label}: requiresReview=${result.requiresReview}, reference=${expectedRequired}`,
              );
            }
            if (expectedRequired) {
              const expectedCovers = referenceCovers(
                approver.member,
                feature,
                change,
              );
              if (result.hasCoveringApproval !== expectedCovers) {
                disagreements.push(
                  `${approver.label}: hasCoveringApproval=${result.hasCoveringApproval}, reference=${expectedCovers}`,
                );
              }
              // A required team is satisfied only by a covering approval from
              // one of its members.
              const rule = resolveRule(rules, feature.project ?? "");
              const required = rule?.requiredApproverTeams ?? [];
              const expectedTeams =
                !required.length ||
                (expectedCovers &&
                  required.some((t) => approver.member.teams?.includes(t)));
              if (result.requiredApproverTeams.satisfied !== expectedTeams) {
                disagreements.push(
                  `${approver.label}: requiredTeams=${result.requiredApproverTeams.satisfied}, reference=${expectedTeams}`,
                );
              }
            }
          }
          expect(disagreements).toEqual([]);
        },
      );
    },
  );
});
