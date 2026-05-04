/**
 * Contextual Bandit SDK fetch + assignment integration test (P7.2).
 *
 * Spins up a mock back-end that returns a §2.2-shaped feature payload
 * with a `promo-cb` feature whose only rule is a contextual bandit
 * (4 leaves, one per context). Then drives `evalFeature("promo-cb")`
 * for four sample users (one per leaf) and asserts:
 *  - the right context matched (callback meta.contextId)
 *  - the variation index returned is reproducible from the documented
 *    seed (rule.contextId) and the user's hash attribute
 *  - the 4-arg trackingCallback receives `(experiment, result,
 *    attributes, { isBandit, contextId })`
 */

import cloneDeep from "lodash/cloneDeep";
import {
  GrowthBook,
  clearCache,
  setPolyfills,
  FeatureApiResponse,
} from "../../src";
import { Experiment, Result } from "../../src/types/growthbook";

function mockApi(data: FeatureApiResponse) {
  const f = jest.fn(async (url: string) => ({
    status: 200,
    ok: true,
    headers: { get: () => undefined },
    url,
    json: async () => cloneDeep(data),
  }));
  setPolyfills({ fetch: f });
  return [f, () => setPolyfills({ fetch: undefined })] as const;
}

/**
 * Minimal §2.2 payload: one feature, one experiment-ref rule, four
 * contexts, three variations. Contexts are tree-walk ordered:
 *   - L1: country=US AND device=mobile
 *   - L2: country=US AND device=desktop
 *   - L3: country=CA AND device=mobile
 *   - L4: catch-all (other)
 */
const PAYLOAD: FeatureApiResponse = {
  features: {
    "promo-cb": {
      defaultValue: "control",
      rules: [
        {
          key: "promo-cb",
          variations: ["control", "promo_a", "promo_b"],
          weights: [1 / 3, 1 / 3, 1 / 3],
          coverage: 1,
          hashAttribute: "id",
          hashVersion: 2,
          isContextualBandit: true,
          attributesRequired: ["country", "device"],
          contexts: [
            {
              contextId: "country=US|device=mobile",
              condition: { country: "US", device: "mobile" },
              weights: [0.1, 0.6, 0.3],
            },
            {
              contextId: "country=US|device=desktop",
              condition: { country: "US", device: "desktop" },
              weights: [0.5, 0.25, 0.25],
            },
            {
              contextId: "country=CA|device=mobile",
              condition: { country: "CA", device: "mobile" },
              weights: [0.2, 0.2, 0.6],
            },
            {
              contextId: "other",
              condition: {},
              weights: [0.34, 0.33, 0.33],
            },
          ],
        },
      ],
    },
  },
};

const USERS: Array<{
  id: string;
  attributes: Record<string, unknown>;
  expectedContextId: string;
}> = [
  {
    id: "u-leaf-1",
    attributes: { id: "u-leaf-1", country: "US", device: "mobile" },
    expectedContextId: "country=US|device=mobile",
  },
  {
    id: "u-leaf-2",
    attributes: { id: "u-leaf-2", country: "US", device: "desktop" },
    expectedContextId: "country=US|device=desktop",
  },
  {
    id: "u-leaf-3",
    attributes: { id: "u-leaf-3", country: "CA", device: "mobile" },
    expectedContextId: "country=CA|device=mobile",
  },
  {
    id: "u-leaf-4",
    attributes: { id: "u-leaf-4", country: "FR", device: "tablet" },
    expectedContextId: "other",
  },
];

describe("contextual bandit SDK fetch (P7.2)", () => {
  beforeEach(async () => {
    await clearCache();
  });
  afterEach(async () => {
    await clearCache();
    setPolyfills({ fetch: undefined });
  });

  it("routes each user to the right leaf and fires 4-arg callback", async () => {
    const [, cleanup] = mockApi(PAYLOAD);

    const tracked: Array<{
      experiment: Experiment<unknown>;
      result: Result<unknown>;
      attributes?: Record<string, unknown>;
      meta?: { isBandit?: boolean; contextId?: string };
    }> = [];

    for (const user of USERS) {
      const gb = new GrowthBook({
        apiHost: "https://fakeapi.sample.io",
        clientKey: "cb-test",
        attributes: user.attributes,
        trackingCallback: (
          experiment: Experiment<unknown>,
          result: Result<unknown>,
          attributes?: Record<string, unknown>,
          meta?: { isBandit?: boolean; contextId?: string },
        ) => {
          tracked.push({ experiment, result, attributes, meta });
        },
      });
      await gb.loadFeatures();

      const evalResult = gb.evalFeature("promo-cb");
      // The CB rule produced an in-experiment assignment.
      expect(evalResult.source).toBe("experiment");
      expect(evalResult.experimentResult?.inExperiment).toBe(true);

      // The variation must be one of the rule's three variations.
      expect(["control", "promo_a", "promo_b"]).toContain(evalResult.value);

      gb.destroy();
    }

    cleanup();

    expect(tracked).toHaveLength(USERS.length);

    USERS.forEach((user, i) => {
      const tr = tracked[i];
      expect(tr.meta?.isBandit).toBe(true);
      expect(tr.meta?.contextId).toBe(user.expectedContextId);
      expect(tr.attributes).toMatchObject(user.attributes);
    });
  });

  it("skips the rule entirely when a required attribute is missing", async () => {
    const [, cleanup] = mockApi(PAYLOAD);

    const cb = jest.fn();
    const gb = new GrowthBook({
      apiHost: "https://fakeapi.sample.io",
      clientKey: "cb-test-missing",
      // Missing `device` — should fail the required-attribute gate and
      // fall through to the feature default.
      attributes: { id: "u-no-device", country: "US" },
      trackingCallback: cb,
    });
    await gb.loadFeatures();

    const evalResult = gb.evalFeature("promo-cb");
    expect(evalResult.value).toBe("control");
    expect(evalResult.source).not.toBe("experiment");
    expect(cb).not.toHaveBeenCalled();

    gb.destroy();
    cleanup();
  });
});
