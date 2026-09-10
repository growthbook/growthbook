import { describe, expect, it } from "vitest";
import {
  getFeatureHealthSearchTokens,
  getFeatureHealthStates,
} from "@/services/health";

describe("getFeatureHealthStates", () => {
  it("is empty while stale data is loading", () => {
    expect(getFeatureHealthStates(undefined)).toEqual([]);
  });

  it("is detection-off when stale detection is disabled, regardless of data", () => {
    expect(getFeatureHealthStates({ stale: true }, true)).toEqual([
      "detection-off",
    ]);
  });

  it("is empty for a healthy feature", () => {
    expect(
      getFeatureHealthStates({
        stale: false,
        envResults: { prod: { stale: false, reason: "has-rules" } },
      }),
    ).toEqual([]);
  });

  it("is stale when the whole feature is stale", () => {
    expect(
      getFeatureHealthStates({
        stale: true,
        envResults: {
          prod: { stale: true, reason: "no-rules" },
          dev: { stale: true, reason: "no-rules" },
        },
      }),
    ).toEqual(["stale"]);
  });

  it("does not surface partial staleness as a health state", () => {
    expect(
      getFeatureHealthStates({
        stale: false,
        envResults: {
          prod: { stale: false, reason: "has-rules" },
          dev: { stale: true, reason: "no-rules" },
        },
      }),
    ).toEqual([]);
  });

  it("stacks both temp rollout tiers, most urgent first", () => {
    expect(
      getFeatureHealthStates({
        stale: false,
        envResults: {
          prod: {
            stale: false,
            reason: "has-rules",
            tempRollout: "old-temp-rollout",
          },
          staging: {
            stale: false,
            reason: "temp-rollout",
            tempRollout: "temp-rollout",
          },
          dev: { stale: true, reason: "no-rules" },
        },
      }),
    ).toEqual(["old-temp-rollout", "temp-rollout"]);
  });
});

describe("getFeatureHealthSearchTokens", () => {
  it("lets health:temp-rollout match an old temp rollout", () => {
    expect(
      getFeatureHealthSearchTokens({
        stale: false,
        envResults: {
          prod: {
            stale: false,
            reason: "has-rules",
            tempRollout: "old-temp-rollout",
          },
        },
      }),
    ).toEqual(["old-temp-rollout", "temp-rollout"]);
  });

  it("does not duplicate temp-rollout when both tiers are present", () => {
    expect(
      getFeatureHealthSearchTokens({
        stale: false,
        envResults: {
          prod: {
            stale: false,
            reason: "has-rules",
            tempRollout: "old-temp-rollout",
          },
          dev: {
            stale: false,
            reason: "temp-rollout",
            tempRollout: "temp-rollout",
          },
        },
      }),
    ).toEqual(["old-temp-rollout", "temp-rollout"]);
  });

  it("adds partially-stale as a search-only token", () => {
    expect(
      getFeatureHealthSearchTokens({
        stale: false,
        envResults: {
          prod: {
            stale: false,
            reason: "temp-rollout",
            tempRollout: "temp-rollout",
          },
          dev: { stale: true, reason: "no-rules" },
        },
      }),
    ).toEqual(["temp-rollout", "partially-stale"]);
  });

  it("is only detection-off when detection is disabled", () => {
    expect(
      getFeatureHealthSearchTokens(
        { stale: false, envResults: { dev: { stale: true } } },
        true,
      ),
    ).toEqual(["detection-off"]);
    expect(getFeatureHealthSearchTokens(undefined)).toEqual([]);
  });
});

describe("getFeatureHealthStates with a stale old temp rollout", () => {
  it("reports both the stale verdict and the rollout to clean up", () => {
    expect(
      getFeatureHealthStates({
        stale: true,
        envResults: {
          prod: {
            stale: true,
            reason: "old-temp-rollout",
            tempRollout: "old-temp-rollout",
          },
        },
      }),
    ).toEqual(["old-temp-rollout", "stale"]);
  });
});
