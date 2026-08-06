import {
  archiveFootprintForControl,
  featurePublishFootprint,
  revertFootprint,
  serveFootprint,
} from "shared/permissions";
import type { FeatureInterface } from "shared/types/feature";
import type { OrganizationInterface } from "shared/types/organization";
import type { MergeResultChanges } from "shared/util";
import type { Context } from "back-end/src/models/BaseModel";
import { archiveServeFootprint } from "back-end/src/revisions/revisionPublishEnvironments";
import { getMergeResultPublishEnvs } from "back-end/src/services/features";
import { revertFootprint as serverRevertFootprint } from "back-end/src/revisions/featureDraftAuthority";

/**
 * Does a CONTROL derive the same environment FOOTPRINT its endpoint will?
 *
 * `permission-prediction-parity` proves the two agree on the ATOM, but it hand-feeds
 * the environment list to both sides — so it has never been able to see the defect
 * that actually keeps happening. Across five review rounds, most front-end findings
 * were one shape: a control and its endpoint deriving the footprint from the same
 * entity and reaching different answers. Each round fixed one call site and the next
 * round found another.
 *
 * This closes the class by construction: ONE fixture, and each case computes both
 * sides and asserts equality. Where the two genuinely may differ, the case says so
 * and pins the direction — a control may demand MORE than its endpoint (annoying but
 * safe) and must never demand LESS.
 */

const ENV_IDS = ["dev", "staging", "production"];
const ORG_ENVS = [
  { id: "dev", description: "" },
  { id: "staging", description: "" },
  // Scoped away from `prj_api`, so any site using raw org envs over-demands.
  { id: "production", description: "", projects: ["prj_web"] },
] as unknown as { id: string; projects?: string[] }[];

const org = {
  id: "org_parity",
  settings: { environments: ORG_ENVS },
} as unknown as OrganizationInterface;
const context = { org } as unknown as Context;

const feature = {
  id: "flag",
  organization: "org_parity",
  project: "prj_web",
  defaultValue: "false",
  valueType: "boolean",
  rules: [],
  environmentSettings: {
    dev: { enabled: true },
    staging: { enabled: true },
    production: { enabled: true },
  },
} as unknown as FeatureInterface;

describe("archive footprint: control === endpoint", () => {
  // The bug this pins survived a sweep that fixed seven sibling sites, because the
  // raw org-env list reads correct and is wrong: `production` is scoped to
  // `prj_web`, so it never serves an entity in `prj_api`.
  it.each([
    ["an entity in a project every environment serves", "prj_web"],
    ["an entity in a project production is scoped away from", "prj_api"],
    ["an entity in no project", ""],
  ])("agrees for %s", (_label, project) => {
    const entity = { project };
    const control = archiveFootprintForControl({
      environments: ORG_ENVS,
      entity,
    });
    const endpoint = archiveServeFootprint(context, entity);
    expect([...control].sort()).toEqual([...endpoint].sort());
  });

  it("agrees for a scoped Config, where the scoped list wins on both sides", () => {
    const entity = { project: "prj_web" };
    const scoped = ["dev"];
    expect(
      archiveFootprintForControl({ environments: ORG_ENVS, entity, scoped }),
    ).toEqual(archiveServeFootprint(context, entity, scoped));
  });

  // Raw org envs are the form that keeps reappearing: it is a strict SUPERSET here,
  // so it fails closed — a Deleter is refused an archive the endpoint allows.
  it("is NOT the raw org-environment list for a project-scoped entity", () => {
    const entity = { project: "prj_api" };
    expect(archiveServeFootprint(context, entity)).not.toEqual(
      ORG_ENVS.map((e) => e.id),
    );
  });
});

describe("feature publish footprint: control === endpoint", () => {
  // Both sides call the same shared function, so this pins that they are fed
  // equivalent INPUTS — the universe and the live rules — which is where they drifted.
  const cases: [string, MergeResultChanges][] = [
    ["a rules-only change in dev", { rules: [] }],
    ["a default-value change", { defaultValue: "true" }],
    ["an environment toggle", { environmentsEnabled: { production: true } }],
    ["an archive", { archived: true }],
    ["payload-INERT metadata", { metadata: { description: "x" } }],
    ["payload-affecting metadata", { metadata: { project: "prj_api" } }],
  ];

  it.each(cases)("agrees for %s", async (_label, changes) => {
    const endpoint = await getMergeResultPublishEnvs({
      context: {
        ...context,
        models: { holdout: { getById: async () => null } },
      } as unknown as Context,
      feature,
      filledLiveRules: feature.rules ?? [],
      result: changes,
      environmentIds: ENV_IDS,
    });
    const control = featurePublishFootprint({
      feature,
      liveRules: feature.rules ?? [],
      changes,
      environmentIds: ENV_IDS,
      holdoutEnvs: [],
    });
    expect([...control].sort()).toEqual([...endpoint].sort());
  });

  // Inert metadata reaching no SDK is the whole reason a description edit must not
  // demand production. If this ever widens, the edit-info modal starts 403ing again.
  it("does not widen for payload-inert metadata", async () => {
    const envs = await getMergeResultPublishEnvs({
      context: {
        ...context,
        models: { holdout: { getById: async () => null } },
      } as unknown as Context,
      feature,
      filledLiveRules: feature.rules ?? [],
      result: {
        metadata: { description: "x" },
        environmentsEnabled: { dev: true },
      } as MergeResultChanges,
      environmentIds: ENV_IDS,
    });
    expect(envs).toEqual(["dev"]);
  });
});

describe("revert footprint: control === endpoint", () => {
  // The control imports the shared function; the endpoint re-exports it. This pins
  // that they stay the same function rather than diverging into two copies.
  it.each([
    ["a target that enables nothing new", {}],
    [
      "a target that re-enables production",
      { environmentsEnabled: { production: true } },
    ],
  ])("agrees for %s", (_label, targetRevision) => {
    const changedEnvs = ["dev"];
    expect(
      revertFootprint({
        feature,
        targetRevision,
        environmentIds: ENV_IDS,
        changedEnvs,
      }).sort(),
    ).toEqual(
      serverRevertFootprint({
        feature,
        targetRevision: targetRevision as never,
        environmentIds: ENV_IDS,
        changedEnvs,
      }).sort(),
    );
  });
});

describe("serve footprint is never empty for an entity that serves anywhere", () => {
  // An empty footprint SKIPS the environment check rather than narrowing it, so an
  // accidental [] is a silent over-permit. Every archive-class site routes through
  // these two functions, so pinning both here covers the class.
  it.each([["prj_web"], ["prj_api"], [""]])(
    "for project %s",
    (project: string) => {
      expect(serveFootprint(ORG_ENVS, { project })).not.toEqual([]);
      expect(archiveServeFootprint(context, { project })).not.toEqual([]);
    },
  );
});
