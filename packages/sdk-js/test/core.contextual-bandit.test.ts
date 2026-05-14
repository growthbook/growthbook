/// <reference types="jest" />

import {
  ContextsEntry,
  FeatureDefinition,
  GrowthBook,
  TrackingCallback,
} from "../src";

const makeFeature = (
  contexts: ContextsEntry[],
  attributesRequired: string[] = ["country"],
): FeatureDefinition<string> => ({
  defaultValue: "default",
  rules: [
    {
      id: "bandit-rule",
      key: "bandit-exp",
      variations: ["control", "treatment"],
      hashAttribute: "id",
      hashVersion: 2,
      seed: "phase-0",
      isContextualBandit: true,
      attributesRequired,
      contexts,
    },
  ],
});

const evaluate = ({
  attributes,
  contexts,
  trackingCallback,
  attributesRequired,
}: {
  attributes: Record<string, unknown>;
  contexts: ContextsEntry[];
  trackingCallback?: TrackingCallback;
  attributesRequired?: string[];
}) => {
  const growthbook = new GrowthBook({
    attributes,
    trackingCallback,
    features: {
      bandit: makeFeature(contexts, attributesRequired),
    },
  });

  const result = growthbook.evalFeature("bandit");
  growthbook.destroy();
  return result;
};

describe("contextual bandit feature rules", () => {
  it("skips the rule when required attributes are missing", () => {
    const trackingCallback = jest.fn();

    const result = evaluate({
      attributes: { id: "user-1" },
      trackingCallback,
      contexts: [
        {
          contextId: "catch-all",
          condition: {},
          weights: [0, 1],
        },
      ],
    });

    expect(result.value).toEqual("default");
    expect(result.source).toEqual("defaultValue");
    expect(trackingCallback).not.toHaveBeenCalled();
  });

  it("uses the matching context weights and tracks context metadata", () => {
    const trackingCallback = jest.fn();

    const result = evaluate({
      attributes: { id: "user-1", country: "US" },
      trackingCallback,
      contexts: [
        {
          contextId: "us",
          condition: { country: "US" },
          weights: [0, 1],
        },
        {
          contextId: "catch-all",
          condition: {},
          weights: [1, 0],
        },
      ],
    });

    expect(result.value).toEqual("treatment");
    expect(result.source).toEqual("experiment");
    expect(trackingCallback).toHaveBeenCalledTimes(1);
    expect(trackingCallback.mock.calls[0][2]).toEqual({
      id: "user-1",
      country: "US",
    });
    expect(trackingCallback.mock.calls[0][3]).toEqual({
      isBandit: true,
      contextId: "us",
    });
  });

  it("uses the first matching context when multiple contexts match", () => {
    const trackingCallback = jest.fn();

    const result = evaluate({
      attributes: { id: "user-1", country: "US" },
      trackingCallback,
      contexts: [
        {
          contextId: "first",
          condition: { country: "US" },
          weights: [1, 0],
        },
        {
          contextId: "second",
          condition: { country: "US" },
          weights: [0, 1],
        },
      ],
    });

    expect(result.value).toEqual("control");
    expect(trackingCallback.mock.calls[0][3]).toEqual({
      isBandit: true,
      contextId: "first",
    });
  });

  it("supports a catch-all context with an empty condition", () => {
    const trackingCallback = jest.fn();

    const result = evaluate({
      attributes: { id: "user-1", country: "MX" },
      trackingCallback,
      contexts: [
        {
          contextId: "ca",
          condition: { country: "CA" },
          weights: [1, 0],
        },
        {
          contextId: "catch-all",
          condition: {},
          weights: [0, 1],
        },
      ],
    });

    expect(result.value).toEqual("treatment");
    expect(trackingCallback.mock.calls[0][3]).toEqual({
      isBandit: true,
      contextId: "catch-all",
    });
  });

  it("supports legacy two-argument tracking callbacks", () => {
    const calls: Array<{ experimentKey: string; variationId: number }> = [];
    const trackingCallback: TrackingCallback = (experiment, result) => {
      calls.push({
        experimentKey: experiment.key,
        variationId: result.variationId,
      });
    };

    const result = evaluate({
      attributes: { id: "user-1", country: "US" },
      trackingCallback,
      contexts: [
        {
          contextId: "us",
          condition: { country: "US" },
          weights: [0, 1],
        },
      ],
    });

    expect(result.value).toEqual("treatment");
    expect(calls).toEqual([{ experimentKey: "bandit-exp", variationId: 1 }]);
  });

  it("matches the four-leaf walkthrough fixture", () => {
    const contexts: ContextsEntry[] = [
      {
        contextId: "vip-mobile",
        condition: { $and: [{ tier: "vip" }, { device: "mobile" }] },
        weights: [0, 1],
      },
      {
        contextId: "vip-desktop",
        condition: { $and: [{ tier: "vip" }, { device: "desktop" }] },
        weights: [1, 0],
      },
      {
        contextId: "free-mobile",
        condition: { $and: [{ tier: "free" }, { device: "mobile" }] },
        weights: [1, 0],
      },
      {
        contextId: "other",
        condition: {},
        weights: [0, 1],
      },
    ];
    const users = [
      { id: "user-1", tier: "vip", device: "mobile" },
      { id: "user-2", tier: "vip", device: "desktop" },
      { id: "user-3", tier: "free", device: "mobile" },
      { id: "user-4", tier: "free", device: "desktop" },
    ];

    const walkthrough = users.map((attributes) => {
      const trackingCallback = jest.fn();
      const result = evaluate({
        attributes,
        contexts,
        trackingCallback,
        attributesRequired: ["tier", "device"],
      });

      return {
        contextId: trackingCallback.mock.calls[0][3].contextId,
        userId: attributes.id,
        value: result.value,
        variationId: result.experimentResult?.variationId,
      };
    });

    expect(walkthrough).toMatchInlineSnapshot(`
[
  {
    "contextId": "vip-mobile",
    "userId": "user-1",
    "value": "treatment",
    "variationId": 1,
  },
  {
    "contextId": "vip-desktop",
    "userId": "user-2",
    "value": "control",
    "variationId": 0,
  },
  {
    "contextId": "free-mobile",
    "userId": "user-3",
    "value": "control",
    "variationId": 0,
  },
  {
    "contextId": "other",
    "userId": "user-4",
    "value": "treatment",
    "variationId": 1,
  },
]
`);
  });
});
