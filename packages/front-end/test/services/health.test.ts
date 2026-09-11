import { describe, expect, it } from "vitest";
import {
  describeFeatureHealthEntry,
  entryMatchesHealthFilter,
  getFeatureHealthSearchTokens,
  getFeatureHealthSeverity,
  getFeatureHealthStates,
  getFeatureStaleSearchTokens,
} from "@/services/health";

describe("getFeatureHealthStates", () => {
  it("is empty while stale data is loading", () => {
    expect(getFeatureHealthStates(undefined)).toEqual([]);
  });

  it("reads the server's deduped signals in order", () => {
    expect(
      getFeatureHealthStates({
        stale: false,
        health: [
          { signal: "invalid-value", count: 1 },
          { signal: "ramp-needs-approval", count: 3 },
        ],
      }),
    ).toEqual(["invalid-value", "ramp-needs-approval"]);
  });
});

describe("describeFeatureHealthEntry", () => {
  it("adds counts to the description", () => {
    expect(
      describeFeatureHealthEntry({
        signal: "unreachable-rule",
        count: 2,
        environments: ["dev", "prod"],
      }),
    ).toBe(
      "An earlier rule always matches, so this rule never runs. 2 occurrences.",
    );
    expect(
      describeFeatureHealthEntry({ signal: "ramp-paused", count: 1 }),
    ).toBe("A ramp schedule is paused.");
  });

  it("names each experiment and when it stopped for temp rollouts", () => {
    const since = new Date(Date.now() - 400 * 86400000).toISOString();
    expect(
      describeFeatureHealthEntry({
        signal: "old-temp-rollout",
        count: 1,
        environments: ["production"],
        details: [{ label: "Checkout test", since }],
      }),
    ).toMatch(
      /^Experiment "Checkout test" stopped (about|over) 1 year ago and its rollout is still being served\. Stop it on the experiment once the winner is in code\.$/,
    );
  });
});

describe("getFeatureHealthSearchTokens", () => {
  it("lets health:temp-rollout match an old temp rollout and adds severity", () => {
    expect(
      getFeatureHealthSearchTokens({
        stale: false,
        health: [{ signal: "old-temp-rollout", count: 1 }],
      }),
    ).toEqual(["old-temp-rollout", "temp-rollout", "medium"]);
  });

  it("does not duplicate temp-rollout when both tiers are present", () => {
    expect(
      getFeatureHealthSearchTokens({
        stale: false,
        health: [
          { signal: "old-temp-rollout", count: 1 },
          { signal: "temp-rollout", count: 1 },
        ],
      }),
    ).toEqual(["old-temp-rollout", "temp-rollout", "medium", "low"]);
  });
});

describe("entryMatchesHealthFilter", () => {
  it("matches by signal, temp-rollout alias, or severity", () => {
    const old = { signal: "old-temp-rollout" as const, count: 1 };
    expect(entryMatchesHealthFilter(old, ["old-temp-rollout"])).toBe(true);
    expect(entryMatchesHealthFilter(old, ["temp-rollout"])).toBe(true);
    expect(entryMatchesHealthFilter(old, ["medium"])).toBe(true);
    expect(entryMatchesHealthFilter(old, ["high", "ramp-paused"])).toBe(false);
    expect(entryMatchesHealthFilter(old, [])).toBe(false);
  });
});

describe("severity", () => {
  it("maps colors to high, medium, low and reports the most severe overall", () => {
    expect(getFeatureHealthSeverity("invalid-value")).toBe("high");
    expect(getFeatureHealthSeverity("unreachable-rule")).toBe("medium");
    expect(getFeatureHealthSeverity("ramp-paused")).toBe("medium");
    expect(getFeatureHealthSeverity("old-temp-rollout")).toBe("medium");
    expect(getFeatureHealthSeverity("temp-rollout")).toBe("low");
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
