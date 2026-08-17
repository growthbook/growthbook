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

const environments: Environment[] = [
  { id: "dev", description: "" },
  { id: "staging", description: "" },
  { id: "production", description: "" },
  // Scoped away from the flag's project — never serves it.
  { id: "edge", description: "", projects: ["prj_other"] },
  // Applicable but disabled; only toggle changes should include qa.
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
    // Disabled here so only a ramp can add staging.
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
    // Enabled to expose callers that fail to filter the environment universe.
    edge: { enabled: true, rules: [] },
  },
} as unknown as FeatureInterface;

/** What the endpoint's universe is: applicable to the flag's projects. */
const applicableIds = serveFootprint(environments, feature);

describe("control footprint === endpoint footprint", () => {
  it("feature publish, rules-only draft: the environments whose rules differ", () => {
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

  it("feature publish, an environment toggle: exactly the toggled environments", () => {
    expect(
      [
        ...getRevisionPublishEnvs({
          liveFeature: feature,
          changes: { environmentsEnabled: { qa: true, production: false } },
          environments,
          holdoutsMap: new Map(),
        }),
      ].sort(),
    ).toEqual(["production", "qa"]);
  });

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
    ).toEqual(["staging"]);
  });

  it("feature publish, an UNRESOLVED holdout widens rather than narrows", () => {
    expect(
      [
        ...getRevisionPublishEnvs({
          liveFeature: feature,
          changes: { holdout: { id: "hld_missing", value: "control" } },
          environments,
          holdoutsMap: new Map(),
        }),
      ].sort(),
    ).toEqual([...environmentIds].sort());
  });

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
    // The empty changes object isolates the revision ramp-action footprint.
    const changes = {};
    const control = getRevisionPublishEnvs({
      liveFeature: feature,
      changes,
      environments,
      holdoutsMap: new Map(),
      rampActions: rampActions as never,
    });
    expect([...control].sort()).toEqual([
      "dev",
      "edge",
      "production",
      "staging",
    ]);
  });

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
    expect([...control].sort()).toEqual(["dev", "production"]);
  });

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

  // Only helpers that perform their own environment narrowing belong here.
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

  // Assert a positive result so an empty fail-open footprint cannot pass.
  it("generic archive answers for every applicable environment", () => {
    expect(
      [...archiveFootprintForControl({ environments, entity: feature })].sort(),
    ).toEqual(["dev", "production", "qa", "staging"]);
  });

  // Feature archives affect applicable, enabled environments only.
  it("feature archive answers only where the flag is enabled", () => {
    expect(
      getEnabledEnvironments(
        feature,
        filterEnvironmentsByFeature(environments, feature),
      ).sort(),
    ).toEqual(["dev", "production"]);
  });

  it("revert answers for serving, re-enabled and rule-changed environments", () => {
    expect(
      [
        ...revertFootprint({
          feature,
          targetRevision: {
            environmentsEnabled: { staging: true, edge: true },
          },
          environmentIds: applicableIds,
          changedEnvs: ["qa"],
        }),
      ].sort(),
    ).toEqual(["dev", "production", "qa", "staging"]);
  });

  // The caller owns universe narrowing; this helper must not widen it.
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

  // A staged move includes environments applicable only at the destination.
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

// Helper coverage does not verify that each page passes this footprint onward.
describe("the cancel footprint is the entity's own scope, unwidened", () => {
  const scopedConfig = { scopedConfig: { environments: ["dev"] } };
  const baseConfig = {};

  it("a scoped Config answers with exactly its own environments", () => {
    expect(configPublishEnvironments(scopedConfig)).toEqual(["dev"]);
  });

  it("a base Config answers unbound rather than widening to everywhere", () => {
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
