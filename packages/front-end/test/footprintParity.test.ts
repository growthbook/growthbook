import { describe, it, expect } from "vitest";
import {
  archiveFootprintForControl,
  featurePublishFootprint,
  rampActionFootprint,
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
  },
} as unknown as FeatureInterface;

/** What the endpoint's universe is: applicable to the flag's projects. */
const applicableIds = serveFootprint(environments, feature);

describe("control footprint === endpoint footprint", () => {
  // The endpoint calls `featurePublishFootprint`; the control calls
  // `getRevisionPublishEnvs`, which wraps it. Equality here is what proves the
  // wrapper feeds it the same live basis, universe and holdout resolution.
  it("feature publish, rules-only draft", () => {
    const changes = { rules: [] };
    const control = getRevisionPublishEnvs({
      liveFeature: feature,
      changes,
      environments,
      holdoutsMap: new Map(),
    });
    const endpoint = featurePublishFootprint({
      feature,
      liveRules: feature.rules ?? [],
      changes,
      environmentIds,
      holdoutEnvs: [],
    });
    expect([...control].sort()).toEqual([...endpoint].sort());
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
    const endpointRamp = rampActionFootprint({
      rampActions: rampActions as never,
      liveRules: feature.rules ?? [],
      environmentIds,
    });
    const endpointBase = featurePublishFootprint({
      feature,
      liveRules: feature.rules ?? [],
      changes,
      environmentIds,
      holdoutEnvs: [],
    });
    const endpoint =
      endpointRamp === "all"
        ? environmentIds
        : [...new Set([...endpointBase, ...endpointRamp])];

    expect([...control].sort()).toEqual([...endpoint].sort());
    // And it mentions STAGING — where the target rule serves and the base footprint
    // does not reach. If the control drops the ramp term this is the assertion that
    // notices; without it the ramp's contribution is masked by the base.
    expect(control).toContain("staging");
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
    // The endpoint's answer for a payload-affecting metadata change.
    const endpoint = featurePublishFootprint({
      feature,
      liveRules: feature.rules ?? [],
      changes: { metadata: proposed } as never,
      environmentIds: applicableIds,
      holdoutEnvs: [],
    });
    expect([...control].sort()).toEqual([...endpoint].sort());
    // Non-empty, because an empty footprint SKIPS the check.
    expect(control.length).toBeGreaterThan(0);
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
  it("never answers for an environment scoped away from the flag", () => {
    const cases = [
      getMetadataEditEnvs({
        feature,
        proposed: { project: "prj_other" },
        environments,
      }),
      getRevisionPublishEnvs({
        liveFeature: feature,
        changes: { defaultValue: "true" },
        environments,
        holdoutsMap: new Map(),
      }),
      archiveFootprintForControl({ environments, entity: feature }),
      revertFootprint({
        feature,
        targetRevision: { environmentsEnabled: {} },
        environmentIds: applicableIds,
      }),
    ];
    for (const answer of cases) expect(answer).not.toContain("edge");
  });
});
