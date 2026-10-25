/// <reference types="jest" />

import type { ExperimentTargetingData } from "shared/types/experiment";
import {
  changedTargeting,
  experimentFieldValue,
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
