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

/**
 * Does a CONTROL derive the same footprint its ENDPOINT will?
 *
 * The previous version of this lived in the back-end suite and imported only
 * `shared/` and `back-end/` — so it compared two HELPERS and never evaluated a
 * control at all. It would have caught none of the six front-end findings from the
 * round it was written for, because the helper was never where the bugs were: they
 * were in what the control FEEDS the helper — which entity it receives, which basis
 * it reads, which environment universe it builds.
 *
 * So this runs in the FRONT-END suite, calls the real control functions, and holds
 * them to the shared functions the endpoints call. The fixture is deliberately
 * awkward in the ways that have caught bugs:
 *
 *  - `edge` is scoped to a project the flag is NOT in, so a control that builds its
 *    universe from raw org environments over-demands observably.
 *  - the flag serves dev and production but not staging, so "serving" and "all"
 *    differ.
 *  - a ramp patch names no environments, which is the shape the UI actually emits.
 */

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
          changedEnvs: ["dev"],
        }),
      ].sort(),
      // serving (dev, edge→excluded by the universe, production) ∪ {staging} ∪ {dev}.
    ).toEqual(["dev", "production", "staging"]);
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
