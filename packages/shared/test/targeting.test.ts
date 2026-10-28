/// <reference types="jest" />

import type { ExperimentTargetingData } from "shared/types/experiment";
import {
  changedTargeting,
  conflictingFields,
  experimentFieldLabels,
  experimentFieldValue,
  getTargetingDefaults,
  hasAttributeCondition,
  hasTargetingConfigured,
} from "../src/experiments/targeting";

declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => void) => void;
declare const expect: (value: unknown) => {
  toBe: (expected: unknown) => void;
  toEqual: (expected: unknown) => void;
};

describe("hasAttributeCondition", () => {
  it("returns false for empty / missing conditions", () => {
    expect(hasAttributeCondition(undefined)).toBe(false);
    expect(hasAttributeCondition("")).toBe(false);
    expect(hasAttributeCondition("{}")).toBe(false);
  });

  it("returns true for a non-empty condition", () => {
    expect(hasAttributeCondition('{"country":"US"}')).toBe(true);
  });
});

describe("hasTargetingConfigured", () => {
  it("returns false when nothing is configured", () => {
    expect(hasTargetingConfigured(undefined)).toBe(false);
    expect(hasTargetingConfigured({})).toBe(false);
    expect(
      hasTargetingConfigured({
        condition: "{}",
        savedGroups: [],
        prerequisites: [],
      }),
    ).toBe(false);
  });

  it("returns true when an attribute condition is set", () => {
    expect(
      hasTargetingConfigured({
        condition: '{"country":{"$in":["US","CA"]},"age":{"$gte":18}}',
      }),
    ).toBe(true);
  });

  it("returns true when saved groups are set", () => {
    expect(
      hasTargetingConfigured({
        savedGroups: [{ match: "all", ids: ["grp_1"] }],
      }),
    ).toBe(true);
  });

  it("returns true when prerequisites are set", () => {
    expect(
      hasTargetingConfigured({
        prerequisites: [{ id: "prereq_1", condition: '{"value":true}' }],
      }),
    ).toBe(true);
  });
});

describe("changedTargeting", () => {
  const loaded: ExperimentTargetingData = {
    condition: "",
    savedGroups: [],
    prerequisites: [],
    coverage: 1,
    namespace: { enabled: false, name: "", range: [0, 1] },
    seed: "seed",
    variationWeights: [0.5, 0.5],
    variations: [{ id: "v0", status: "active" }],
    hashAttribute: "id",
    fallbackAttribute: "",
    attributeScopeAllProjects: false,
    hashVersion: 2,
    disableStickyBucketing: false,
    bucketVersion: 1,
    minBucketVersion: 0,
    trackingKey: "exp",
    newPhase: false,
    reseed: true,
  };

  it("names only what changed, reading either empty condition as none", () => {
    expect(
      changedTargeting(
        {
          ...loaded,
          condition: "{}",
          coverage: 0.4,
          hashAttribute: "device",
          // The release plan's and the experiment's to set.
          newPhase: true,
          variations: [],
          bucketVersion: undefined,
        },
        loaded,
      ),
    ).toEqual({ coverage: 0.4, hashAttribute: "device" });
  });
});

describe("getTargetingDefaults", () => {
  it("lets a release's first bucket bump count as a change", () => {
    const live = getTargetingDefaults(
      {
        variations: [],
        hashAttribute: "id",
        trackingKey: "exp",
        phases: [],
      },
      2,
    );
    expect(changedTargeting({ ...live, bucketVersion: 1 }, live)).toEqual({
      bucketVersion: 1,
    });
  });
});

describe("experimentFieldValue", () => {
  it("reads targeting off the latest phase and the rest off the experiment", () => {
    const experiment = {
      hashAttribute: "device",
      phases: [{ coverage: 1 }, { coverage: 0.4 }],
    };
    expect(experimentFieldValue(experiment, "coverage")).toBe(0.4);
    expect(experimentFieldValue(experiment, "hashAttribute")).toBe("device");
    expect(experimentFieldValue(experiment, "condition")).toBe(null);
    expect(experimentFieldValue({ phases: [] }, "coverage")).toBe(null);
  });
});

describe("conflictingFields", () => {
  it("names only a field someone saved since, to something else", () => {
    const experiment = { hypothesis: "theirs", phases: [{ coverage: 0.5 }] };
    expect(
      conflictingFields(experiment, {
        changes: { hypothesis: "mine", coverage: 0.4 },
        base: { hypothesis: "loaded", coverage: 0.5 },
      }),
    ).toEqual(["hypothesis"]);
    expect(
      conflictingFields(experiment, {
        changes: { hypothesis: "theirs" },
        base: { hypothesis: "loaded" },
      }),
    ).toEqual([]);
  });

  it("tells a None metric window apart from following the metric", () => {
    const override = { id: "m", regressionAdjustmentOverride: true };
    expect(
      conflictingFields(
        { metricOverrides: [{ ...override, windowType: "" }], phases: [] },
        {
          changes: {
            metricOverrides: [
              { ...override, regressionAdjustmentEnabled: true },
            ],
          },
          base: { metricOverrides: [override] },
        },
      ),
    ).toEqual(["metricOverrides"]);
  });
});

describe("experimentFieldLabels", () => {
  it("names each field as the page does, once", () => {
    expect(
      experimentFieldLabels([
        "coverage",
        "skipPartialData",
        "attributionModel",
        "unknownField",
      ]),
    ).toEqual(["traffic percent", "conversion windows", "unknownField"]);
  });
});
