import { describe, it, expect } from "vitest";
import {
  archiveFootprintForControl,
  featurePublishFootprint,
  revertFootprint,
  serveFootprint,
} from "shared/permissions";
import type { FeatureInterface } from "shared/types/feature";
import type { Environment } from "shared/types/organization";
import {
  getMetadataEditEnvs,
  getRevisionPublishEnvs,
} from "@/services/features";

// Hold the real control functions to the footprints used by their endpoints.

const environments: Environment[] = [
  { id: "dev", description: "" },
  { id: "staging", description: "" },
  { id: "production", description: "" },
  // Scoped away from the flag's project — never serves it.
  { id: "edge", description: "", projects: ["prj_other"] },
  // Applicable to the flag (no project restriction) but the flag is DISABLED there
  // and no rule or ramp touches it — so no correct answer in this file includes `qa`.
  // Without it, every environment landed in every answer and "return everything"
  // coincided with correct: `featurePublishFootprint → all envs` and
  // `revertFootprint → all envs` both passed. It is the environment that makes
  // over-answering observable.
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
    // footprint. A ramp aimed here is the only thing that can contribute staging —
    // which is what makes the ramp term's absence observable rather than masked.
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
    // ENABLED on purpose. Without this, `servingEnvironments` dropped `edge` before
    // the universe filter could matter — so a control spelling its universe as raw
    // org environments looked correct, which is the bug this fixture exists to catch.
    edge: { enabled: true, rules: [] },
  },
} as unknown as FeatureInterface;

/** What the endpoint's universe is: applicable to the flag's projects. */
const applicableIds = serveFootprint(environments, feature);

describe("control footprint === endpoint footprint", () => {
  // HARDCODED expectations, not a second call to the same function.
  //
  // Asserting `control === featurePublishFootprint(...)` is unfalsifiable when the
  // control IS that function: gutting the endpoint's rule-diff term, or making it
  // return every environment, passed such a comparison. A parity assertion only
  // means something when the two sides are computed differently — here one side is
  // the real control and the other is a value stated by hand.
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

  // The TOGGLE term, which had no coverage at all: deleting it from
  // `featurePublishFootprint` outright survived every case. `revertFootprint`'s own
  // docstring calls this out as the half historically missed.
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

  // Holdout resolution is the ONLY behaviour this wrapper uniquely has, and it was
  // untested: `holdoutsMap` was always empty and `changes.holdout` never set.
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

  // The case that was fail-open until this round: ramp actions ride the REVISION,
  // so the control had no term for them while the endpoint added their reach.
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
    // Deliberately touches no rules: `{rules: []}` would remove every rule and put
    // staging in the base footprint on its own, masking the ramp term entirely. That
    // masking is why my first version of this case passed against the very bug it
    // was written for.
    const changes = {};
    const control = getRevisionPublishEnvs({
      liveFeature: feature,
      changes,
      environments,
      holdoutsMap: new Map(),
      rampActions: rampActions as never,
    });
    // HARDCODED, not a second call to `rampActionFootprint`: comparing against it let
    // "return all" pass. dev and production are what the flag serves; staging comes
    // from the ramp's target rule, which the flag does NOT serve — so staging present
    // and edge absent together prove the ramp term ran and stayed narrow.
    expect([...control].sort()).toEqual([
      "dev",
      "edge",
      "production",
      "staging",
    ]);
  });

  // The edit-info control. Inline it widened only for a primary-project move, while
  // the endpoint's metadata diff treats a targeting change as payload-affecting.
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
    // Hardcoded, and NOT a second call to `featurePublishFootprint`: with no rule
    // diff its two branches both return `serving`, so `metadataTouchesPayload → false`
    // passed a comparison against it. Stated by hand, the branch matters.
    // `edge` is absent because this helper narrows to the flag's APPLICABLE
    // environments — which is exactly the behaviour a raw-org-envs spelling loses.
    expect([...control].sort()).toEqual(["dev", "production"]);
  });

  // The ENDPOINT's metadata branch, with a rule diff so the two arms diverge. Without
  // one, `touchesGlobalField ? serving ∪ ∅ : serving` returns the same thing either
  // way — which is why `metadataTouchesPayload → false` passed every earlier case.
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

  // The universe, which is where the raw-org-envs spelling kept surviving sweeps.
  //
  // Only helpers that OWN their narrowing belong here. `getRevisionPublishEnvs` takes
  // its universe from the caller and both real call sites narrow before calling it
  // (ReviewAndPublish, RevertModal), so asserting on it would be testing code that
  // isn't in the function — it gets its own case below instead.
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

  // POSITIVELY, because `not.toContain` alone is satisfied by `return []` — and an
  // empty footprint is the exact failure this helper exists to prevent, since it SKIPS
  // the environment check rather than narrowing it.
  it("archive answers for every environment the flag is reachable in", () => {
    expect(
      [...archiveFootprintForControl({ environments, entity: feature })].sort(),
    ).toEqual(["dev", "production", "qa", "staging"]);
  });

  // The revert footprint, with BOTH union terms actually non-empty. Passing an
  // already-narrowed universe, no `environmentsEnabled` and no `changedEnvs` made
  // this tautological — `return [...environmentIds]` satisfied it.
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
          // `qa`, NOT `dev`: dev is already in the serving set, so ["dev"] contributed
          // nothing and deleting this term entirely survived — the same masking I
          // removed elsewhere while the comment here claimed both terms were live.
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
});
