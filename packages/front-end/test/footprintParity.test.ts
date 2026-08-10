import { describe, it, expect } from "vitest";
import {
  archiveFootprintForControl,
  featurePublishFootprint,
  revertFootprint,
  serveFootprint,
  NO_ENVIRONMENT_BINDING,
} from "shared/permissions";
import {
  configPublishEnvironments,
  constantPublishEnvironments,
  filterEnvironmentsByFeature,
} from "shared/util";
import type { FeatureInterface } from "shared/types/feature";
import type { Environment } from "shared/types/organization";
import {
  getEnabledEnvironments,
  getMetadataEditEnvs,
  getMoveWidenedEnvironments,
  getRevisionPublishEnvs,
} from "@/services/features";

// Hold the real control functions to the footprints used by their endpoints.

const environments: Environment[] = [
  { id: "dev", description: "" },
  { id: "staging", description: "" },
  { id: "production", description: "" },
  // Scoped away from the flag's project — never serves it.
  { id: "edge", description: "", projects: ["prj_other"] },
  // Applicable to the flag but DISABLED there with no rule or ramp touching it.
  // Only the toggle case may answer `qa` (toggling is the one term that reaches
  // a disabled environment) — everywhere else its presence means over-answering.
  { id: "qa", description: "" },
];
const environmentIds = environments.map((e) => e.id);

const feature = {
  id: "flag",
  organization: "org",
  project: "prj_web",
  archived: false,
  defaultValue: "false",
  valueType: "boolean",
  rules: [
    {
      id: "fr_prod",
      type: "force",
      value: "true",
      enabled: true,
      description: "",
      environments: ["production"],
    },
    // Serves an environment the flag is DISABLED in, so it is outside the base
    // footprint — a ramp aimed here is the only thing that can contribute
    // staging.
    {
      id: "fr_staging",
      type: "force",
      value: "true",
      enabled: true,
      description: "",
      environments: ["staging"],
    },
  ],
  environmentSettings: {
    dev: { enabled: true, rules: [] },
    staging: { enabled: false, rules: [] },
    production: { enabled: true, rules: [] },
    // ENABLED on purpose: otherwise `servingEnvironments` drops `edge` before
    // the universe filter can matter, and a control using raw org environments
    // as its universe looks correct.
    edge: { enabled: true, rules: [] },
  },
} as unknown as FeatureInterface;

/** What the endpoint's universe is: applicable to the flag's projects. */
const applicableIds = serveFootprint(environments, feature);

describe("control footprint === endpoint footprint", () => {
  // Expectations are hardcoded so the oracle is independent of the implementation.
  it("feature publish, rules-only draft: the environments whose rules differ", () => {
    // Live has a production rule and a staging rule; the draft has neither, so both
    // change. `edge` and `dev` carry no rules either side.
    expect(
      [
        ...getRevisionPublishEnvs({
          liveFeature: feature,
          changes: { rules: [] },
          environments,
          holdoutsMap: new Map(),
        }),
      ].sort(),
    ).toEqual(["production", "staging"]);
  });

  it("feature publish, a global change: everywhere it serves", () => {
    expect(
      [
        ...getRevisionPublishEnvs({
          liveFeature: feature,
          changes: { defaultValue: "true" },
          environments,
          holdoutsMap: new Map(),
        }),
      ].sort(),
    ).toEqual(["dev", "edge", "production"]);
  });

  // The toggle term of `featurePublishFootprint` — the only term that can
  // contribute `qa`.
  it("feature publish, an environment toggle: exactly the toggled environments", () => {
    expect(
      [
        ...getRevisionPublishEnvs({
          liveFeature: feature,
          // One ON and one OFF: both change live state, and `qa` is outside the
          // serving set, so only the toggle term can contribute it.
          changes: { environmentsEnabled: { qa: true, production: false } },
          environments,
          holdoutsMap: new Map(),
        }),
      ].sort(),
    ).toEqual(["production", "qa"]);
  });

  // Holdout resolution is the only behaviour this wrapper uniquely has.
  it("feature publish, a holdout move: the holdout's own environments", () => {
    const holdout = {
      id: "hld_1",
      environmentSettings: { staging: { enabled: true } },
    };
    expect(
      [
        ...getRevisionPublishEnvs({
          liveFeature: feature,
          changes: { holdout: { id: "hld_1", value: "control" } },
          environments,
          holdoutsMap: new Map([["hld_1", holdout]]) as never,
        }),
      ].sort(),
      // Staging comes from the HOLDOUT, which the flag itself does not serve.
    ).toEqual(["staging"]);
  });

  it("feature publish, an UNRESOLVED holdout widens rather than narrows", () => {
    expect(
      [
        ...getRevisionPublishEnvs({
          liveFeature: feature,
          changes: { holdout: { id: "hld_missing", value: "control" } },
          environments,
          // Not loaded: the control cannot say, so it must not answer for less.
          holdoutsMap: new Map(),
        }),
      ].sort(),
    ).toEqual([...environmentIds].sort());
  });

  // Ramp actions ride the REVISION, so the control needs its own term for them
  // — the endpoint adds their reach.
  it("feature publish, draft carrying a ramp action with no named environments", () => {
    const rampActions = [
      {
        mode: "create" as const,
        ruleId: "fr_staging",
        steps: [
          { actions: [{ patch: { ruleId: "fr_staging", coverage: 0 } }] },
        ],
      },
    ];
    // Deliberately touches no rules: `{rules: []}` would remove every rule and
    // put staging in the base footprint on its own, masking the ramp term.
    const changes = {};
    const control = getRevisionPublishEnvs({
      liveFeature: feature,
      changes,
      environments,
      holdoutsMap: new Map(),
      rampActions: rampActions as never,
    });
    // Hardcoded, not a second call to `rampActionFootprint`. Staging (from the
    // ramp's target rule) present and edge absent together prove the ramp term
    // ran and stayed narrow.
    expect([...control].sort()).toEqual([
      "dev",
      "edge",
      "production",
      "staging",
    ]);
  });

  // The edit-info control: the endpoint's metadata diff treats targeting
  // changes as payload-affecting, not just a primary-project move.
  it.each([
    ["a project move", { project: "prj_other" }],
    ["a targeting-project change", { targetingProjects: ["prj_extra"] }],
    ["targeting-all-projects", { targetingAllProjects: true }],
  ])("metadata edit answers for serving envs on %s", (_label, proposed) => {
    const control = getMetadataEditEnvs({
      feature,
      proposed: { project: feature.project, ...proposed },
      environments,
    });
    // Hardcoded, not a second call to `featurePublishFootprint` — with no rule
    // diff its two branches agree, masking the branch. `edge` is absent because
    // this helper narrows to the flag's APPLICABLE environments.
    expect([...control].sort()).toEqual(["dev", "production"]);
  });

  // The ENDPOINT's metadata branch, with a rule diff so the two arms diverge —
  // without one, `touchesGlobalField ? serving ∪ ∅ : serving` returns the same
  // thing either way.
  it.each([
    [
      "a payload-affecting key widens to serving",
      { project: "prj_other" },
      ["dev", "edge", "production"],
    ],
    [
      "an inert key stays narrow",
      { description: "just words" },
      ["production"],
    ],
  ])("endpoint metadata: %s", (_label, metadata, expected) => {
    expect(
      [
        ...featurePublishFootprint({
          feature,
          liveRules: feature.rules ?? [],
          // A rule diff confined to production, so the narrow arm is observably
          // narrower than the wide one.
          changes: {
            rules: (feature.rules ?? []).filter((r) => r.id !== "fr_prod"),
            metadata,
          } as never,
          environmentIds,
          holdoutEnvs: [],
        }),
      ].sort(),
    ).toEqual(expected);
  });

  it("metadata edit answers for nothing when only inert fields change", () => {
    expect(
      getMetadataEditEnvs({
        feature,
        proposed: {
          project: feature.project,
          targetingProjects: feature.targetingProjects,
        },
        environments,
      }),
    ).toEqual([]);
  });

  // Only helpers that OWN their narrowing belong here. `getRevisionPublishEnvs`
  // takes its universe from the caller (ReviewAndPublish, RevertModal both
  // narrow first), so it gets its own contract case below instead.
  it.each([
    [
      "metadata edit",
      () =>
        getMetadataEditEnvs({
          feature,
          proposed: { project: "prj_other" },
          environments,
        }),
    ],
    [
      "archive",
      () => archiveFootprintForControl({ environments, entity: feature }),
    ],
  ])(
    "%s never answers for an environment scoped away from the flag",
    (_l, f) => {
      expect(f()).not.toContain("edge");
    },
  );

  // POSITIVELY, because `not.toContain` alone is satisfied by `return []` — and
  // an empty footprint SKIPS the environment check rather than narrowing it.
  // This is the GENERIC-entity rule (Configs, Constants, Saved Groups); the
  // fixture is feature-shaped only for convenience — no feature control calls
  // this helper.
  it("generic archive answers for every applicable environment", () => {
    expect(
      [...archiveFootprintForControl({ environments, entity: feature })].sort(),
    ).toEqual(["dev", "production", "qa", "staging"]);
  });

  // Feature Flags deliberately archive over a NARROWER basis: applicable AND
  // enabled, because a disabled environment already serves no payload for the
  // flag. Pinned here so the per-family difference is a visible diff, not an
  // accident waiting for unification — see flag-family-authority.md.
  it("feature archive answers only where the flag is enabled", () => {
    expect(
      getEnabledEnvironments(
        feature,
        filterEnvironmentsByFeature(environments, feature),
      ).sort(),
    ).toEqual(["dev", "production"]);
  });

  // The revert footprint, with BOTH union terms non-empty — with either empty,
  // `return [...environmentIds]` satisfies the case.
  it("revert answers for serving, re-enabled and rule-changed environments", () => {
    expect(
      [
        ...revertFootprint({
          feature,
          // The restore switches staging back on, and would have switched `edge` on
          // too — but `edge` is not in the applicable universe, so it must not appear.
          targetRevision: {
            environmentsEnabled: { staging: true, edge: true },
          },
          environmentIds: applicableIds,
          // `qa`, NOT `dev`: dev is already in the serving set, so it would
          // contribute nothing and mask the term.
          changedEnvs: ["qa"],
        }),
      ].sort(),
      // serving ∩ universe (dev, production) ∪ {staging} ∪ {qa}.
    ).toEqual(["dev", "production", "qa", "staging"]);
  });

  // `getRevisionPublishEnvs` is universe-in, universe-out: it answers over exactly
  // what it is handed. The narrowing is the CALLER's job, and both real callers do it
  // — this pins the contract so a future caller passing raw org environments is a
  // visible change here rather than a silent over-demand.
  it("feature publish answers over the universe it is given, nothing wider", () => {
    const narrowed = environments.filter((e) => applicableIds.includes(e.id));
    expect(
      getRevisionPublishEnvs({
        liveFeature: feature,
        changes: { defaultValue: "true" },
        environments: narrowed,
        holdoutsMap: new Map(),
      }),
    ).not.toContain("edge");
  });

  // The move twin: a staged project move makes the destination-only `edge`
  // (scoped to prj_other, enabled on the flag but dormant in prj_web) applicable,
  // and the widened universe surfaces it — the FE counterpart of the
  // getMergeResultPublishEnvs move fix, so the control gates on what the endpoint
  // now demands instead of offering a publish the server rejects.
  it("feature publish widens to destination-applicable envs on a staged move", () => {
    const changes = { metadata: { project: "prj_other" } };
    const widened = getMoveWidenedEnvironments({
      feature,
      changes,
      allEnvironments: environments,
    });
    expect(widened.map((e) => e.id)).toContain("edge");
    expect(
      getRevisionPublishEnvs({
        liveFeature: feature,
        changes,
        environments: widened,
        holdoutsMap: new Map(),
      }),
    ).toContain("edge");
  });

  it("does not widen the universe when nothing moves", () => {
    const widened = getMoveWidenedEnvironments({
      feature,
      changes: { defaultValue: "true" },
      allEnvironments: environments,
    });
    expect(widened.map((e) => e.id)).not.toContain("edge");
  });
});

// The CANCEL footprint, which is not the publish footprint. Cancelling a
// pending schedule is judged by the endpoint on the adapter's
// `canPublishRevision(snapshot)` — the entity's OWN scoped environments, with
// no destination term and no archive-flip widening; a control passing its
// publish footprint hides Cancel from an env-limited publisher the endpoint
// would allow.
//
// NOT COVERED: the page wiring. These hold the shared helpers to the right
// answers, but nothing asserts that `[cfgid]`/`[cid]`/`[sgid]` pass THAT
// answer into `canPublishEntityCoarse` — those pages have no unit tests. Read
// these rows as "the helper is right", not "the control uses it".
describe("the cancel footprint is the entity's own scope, unwidened", () => {
  const scopedConfig = { scopedConfig: { environments: ["dev"] } };
  const baseConfig = {};

  it("a scoped Config answers with exactly its own environments", () => {
    expect(configPublishEnvironments(scopedConfig)).toEqual(["dev"]);
  });

  it("a base Config answers unbound rather than widening to everywhere", () => {
    // NOT the serve footprint: `archiveFootprintForControl` widens a base
    // Config to every environment it serves, which is right for archiving and
    // wrong here.
    expect(configPublishEnvironments(baseConfig)).toEqual(
      NO_ENVIRONMENT_BINDING,
    );
    expect(
      archiveFootprintForControl({
        environments,
        entity: { project: "prj_flag" },
        scoped: configPublishEnvironments(baseConfig),
      }),
    ).not.toEqual(configPublishEnvironments(baseConfig));
  });

  it("a Constant answers unbound when no environment override changes", () => {
    expect(constantPublishEnvironments()).toEqual(NO_ENVIRONMENT_BINDING);
  });
});
