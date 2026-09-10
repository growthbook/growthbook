import { describe, expect, it } from "vitest";
import {
  getFeatureHealthSearchTokens,
  getFeatureHealthStates,
  getFeatureStaleSearchTokens,
} from "@/services/health";

describe("getFeatureHealthStates", () => {
  it("is empty while stale data is loading", () => {
    expect(getFeatureHealthStates(undefined)).toEqual([]);
  });

  it("ignores staleness — that is the Stale column's job", () => {
    expect(
      getFeatureHealthStates({
        stale: true,
        envResults: {
          prod: { stale: true, reason: "no-rules" },
          dev: { stale: true, reason: "no-rules" },
        },
      }),
    ).toEqual([]);
  });

  it("reads temp rollouts from the tempRollout field, not the reason", () => {
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

  it("reports an old rollout even when it made the env stale", () => {
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
    ).toEqual(["old-temp-rollout"]);
  });
});

describe("getFeatureHealthSearchTokens", () => {
  it("lets health:temp-rollout match an old temp rollout", () => {
    expect(
      getFeatureHealthSearchTokens({
        stale: false,
        envResults: { prod: { stale: false, tempRollout: "old-temp-rollout" } },
      }),
    ).toEqual(["old-temp-rollout", "temp-rollout"]);
  });

  it("does not duplicate temp-rollout when both tiers are present", () => {
    expect(
      getFeatureHealthSearchTokens({
        stale: false,
        envResults: {
          prod: { stale: false, tempRollout: "old-temp-rollout" },
          dev: { stale: false, tempRollout: "temp-rollout" },
        },
      }),
    ).toEqual(["old-temp-rollout", "temp-rollout"]);
  });
});

describe("getFeatureStaleSearchTokens", () => {
  it("is stale-detection-off whenever detection is disabled", () => {
    expect(getFeatureStaleSearchTokens({ stale: true }, true)).toEqual([
      "stale-detection-off",
    ]);
  });

  it("is empty while loading", () => {
    expect(getFeatureStaleSearchTokens(undefined)).toEqual([]);
  });

  it("distinguishes stale, partially stale, and healthy", () => {
    expect(getFeatureStaleSearchTokens({ stale: true })).toEqual(["stale"]);
    expect(
      getFeatureStaleSearchTokens({
        stale: false,
        envResults: { prod: { stale: false }, dev: { stale: true } },
      }),
    ).toEqual(["partially-stale"]);
    expect(
      getFeatureStaleSearchTokens({
        stale: false,
        envResults: { prod: { stale: false } },
      }),
    ).toEqual([]);
  });
});
