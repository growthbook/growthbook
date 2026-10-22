import { createCipheriv, randomBytes, webcrypto } from "crypto";
import { TextDecoder } from "util";
import { GrowthBook, GrowthBookClient } from "../../src";
import { decryptPayload } from "../../src/core";
import type {
  FeatureApiResponse,
  FeatureDefinition,
} from "../../src/types/growthbook";
import {
  interleave,
  interleavePlugin,
  teamDraft,
  EVENT_INTERLEAVE_EXPOSURE,
  InterleaveConfig,
  InterleaveExposure,
} from "../../src/plugins/interleave";

const configs: Record<string, InterleaveConfig> = {
  popular: { algorithm: "popular" },
  "buyers-pick": { algorithm: "buyers-pick" },
};
const rankedLists: Record<string, string[]> = {
  popular: ["a", "b", "c", "d"],
  "buyers-pick": ["a", "c", "e", "f"],
  fallback: ["z"],
};
const getList = (config: InterleaveConfig) =>
  rankedLists[config.algorithm as string];
const fallbackConfig = { algorithm: "fallback" };

function flag(
  rule: Record<string, unknown> = {},
): Record<string, FeatureDefinition> {
  return {
    "$interleave:search": {
      defaultValue: "popular",
      rules: [
        {
          id: "$interleave:search",
          force: { interleave: true },
          hashAttribute: "id",
          seed: "il-seed",
          hashVersion: 2,
          ...rule,
        },
      ],
    },
  };
}

function payload(rule?: Record<string, unknown>): FeatureApiResponse {
  return {
    features: flag(rule),
    interleavings: {
      search: {
        trackingKey: "search-tk",
        variations: [
          { key: "popular", config: configs.popular },
          { key: "buyers-pick", config: configs["buyers-pick"] },
        ],
      },
    },
  };
}

function setup(
  attributes: Record<string, unknown> = { id: "u1" },
  rule?: Record<string, unknown>,
) {
  const onExposure = jest.fn();
  const eventLogger = jest.fn();
  const gb = new GrowthBook({
    attributes,
    eventLogger,
    plugins: [interleavePlugin({ onExposure })],
  });
  gb.initSync({ payload: payload(rule) });
  return { gb, onExposure, eventLogger };
}

describe("teamDraft", () => {
  const draft = (a: string[], b: string[], first = 0, maxItems?: number) =>
    teamDraft(
      [
        { variation: "A", items: a },
        { variation: "B", items: b },
      ],
      (id) => id,
      (_, ranker) => (ranker === first ? 0 : 1),
      maxItems,
    );

  it("places a shared top once as a non-competitive tie", () => {
    const { items, meta } = draft(["x", "a"], ["x", "b"]);
    expect(items).toEqual(["x", "a", "b"]);
    expect(meta[0]).toEqual({
      itemId: "x",
      variation: "A",
      position: 0,
      competitive: false,
    });
    expect(meta.slice(1).map((m) => [m.variation, m.competitive])).toEqual([
      ["A", true],
      ["B", true],
    ]);
  });

  it("picks in the seeded order and never repeats an item", () => {
    const { items, meta } = draft(["a", "b", "c"], ["b", "a", "d"], 1);
    expect(items).toEqual(["b", "a", "d", "c"]);
    expect(meta.map((m) => m.variation)).toEqual(["B", "A", "B", "A"]);
    expect(meta.every((m) => m.competitive)).toBe(true);
  });

  it("marks items left after one ranker runs out as non-competitive", () => {
    const { items, meta } = draft(["a"], ["b", "c", "d"]);
    expect(items).toEqual(["a", "b", "c", "d"]);
    expect(meta.map((m) => m.competitive)).toEqual([true, true, false, false]);
  });

  it("stops at maxItems without splitting a competitive round", () => {
    expect(draft(["a", "b"], ["c", "d"], 0, 3).items).toEqual(["a", "c"]);
    expect(draft(["x", "a"], ["x", "b"], 0, 1).items).toEqual(["x"]);
  });
});

describe("interleave", () => {
  it("drafts both rankers' lists and sends one exposure", async () => {
    const { gb, onExposure, eventLogger } = setup();
    const res = await interleave(gb, {
      ranker: "search",
      getList,
      fallbackConfig,
      rankingId: "r1",
    });

    expect(res.inExperiment).toBe(true);
    expect(res.rankingId).toBe("r1");
    expect(res.trackingProps).toEqual({
      experiment_id: "search-tk",
      ranking_id: "r1",
    });
    expect([...res.result].sort()).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(res.result[0]).toBe("a");

    expect(onExposure).toHaveBeenCalledTimes(1);
    const exposure: InterleaveExposure = onExposure.mock.calls[0][0];
    expect(exposure).toMatchObject({
      experimentId: "search-tk",
      rankingId: "r1",
      hashAttribute: "id",
      hashValue: "u1",
    });
    expect(exposure.items.map((i) => i.itemId)).toEqual(res.result);
    expect(exposure.items[0]).toMatchObject({
      itemId: "a",
      competitive: false,
    });
    expect(eventLogger).toHaveBeenCalledWith(
      EVENT_INTERLEAVE_EXPOSURE,
      exposure,
      expect.anything(),
    );
    gb.destroy();
  });

  it("replays the same list for the same rankingId", async () => {
    const { gb } = setup();
    const run = (rankingId: string) =>
      interleave(gb, {
        ranker: "search",
        getList,
        fallbackConfig,
        rankingId,
      });
    expect((await run("same")).result).toEqual((await run("same")).result);
    expect((await run("x")).rankingId).toBe("x");
    expect(
      (await interleave(gb, { ranker: "search", getList, fallbackConfig }))
        .rankingId,
    ).toEqual(expect.any(String));
    gb.destroy();
  });

  it("accepts an async getList and object items", async () => {
    const { gb } = setup();
    const res = await interleave(gb, {
      ranker: "search",
      getList: async (config) => getList(config).map((id) => ({ id })),
      fallbackConfig,
    });
    expect(res.result.map((item) => item.id)).toHaveLength(6);
    gb.destroy();
  });

  it("serves the first ranker's list when items have no id", async () => {
    const { gb, onExposure } = setup();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await interleave(gb, {
      ranker: "search",
      getList: (config) => getList(config).map((name) => ({ name })),
      fallbackConfig,
    });
    expect(res).toMatchObject({
      inExperiment: false,
      variation: "popular",
      trackingProps: {},
    });
    expect(res.result.map((item) => item.name)).toEqual(rankedLists.popular);
    expect(onExposure).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    gb.destroy();
  });

  it("serves the default ranker's config without interleaving when targeting misses", async () => {
    const { gb, onExposure } = setup(
      { id: "u1" },
      {
        condition: { country: "US" },
      },
    );
    const res = await interleave(gb, {
      ranker: "search",
      getList,
      fallbackConfig,
    });
    expect(res).toMatchObject({
      result: rankedLists.popular,
      inExperiment: false,
      variation: "popular",
      trackingProps: {},
    });
    expect(onExposure).not.toHaveBeenCalled();
    gb.destroy();
  });

  it("serves the ranker the flag resolves to when it isn't interleaving", async () => {
    const { gb } = setup({ id: "u1" }, { force: "buyers-pick" });
    const res = await interleave(gb, {
      ranker: "search",
      getList,
      fallbackConfig,
    });
    expect(res.result).toEqual(rankedLists["buyers-pick"]);
    expect(res.variation).toBe("buyers-pick");
    gb.destroy();
  });

  it("serves the default ranker without interleaving when enabled is false", async () => {
    const { gb, onExposure } = setup();
    const res = await interleave(gb, {
      ranker: "search",
      getList,
      fallbackConfig,
      enabled: false,
    });
    expect(res).toMatchObject({
      result: rankedLists.popular,
      inExperiment: false,
      variation: "popular",
      trackingProps: {},
    });
    expect(onExposure).not.toHaveBeenCalled();
    gb.destroy();
  });

  it("uses fallbackConfig when enabled is false and the payload has no interleaving", async () => {
    const gb = new GrowthBook({ attributes: { id: "u1" } });
    gb.initSync({ payload: { features: flag() } });
    const res = await interleave(gb, {
      ranker: "search",
      getList,
      fallbackConfig,
      enabled: false,
    });
    expect(res.result).toEqual(["z"]);
    expect(res.inExperiment).toBe(false);
    gb.destroy();
  });

  it.each([{}, { id: 0 }, { id: false }])(
    "doesn't interleave a user without a valid hash attribute",
    async (attributes) => {
      const { gb, onExposure } = setup(attributes);
      const res = await interleave(gb, {
        ranker: "search",
        getList,
        fallbackConfig,
      });
      expect(res.inExperiment).toBe(false);
      expect(res.result).toEqual(rankedLists.popular);
      expect(onExposure).not.toHaveBeenCalled();
      gb.destroy();
    },
  );

  it("uses fallbackConfig when the interleaving isn't in the payload", async () => {
    const gb = new GrowthBook({ attributes: { id: "u1" } });
    gb.initSync({ payload: { features: flag() } });
    const res = await interleave(gb, {
      ranker: "search",
      getList,
      fallbackConfig,
    });
    expect(res).toMatchObject({
      result: ["z"],
      inExperiment: false,
      trackingProps: {},
    });
    expect(res.variation).toBeUndefined();
    gb.destroy();
  });

  it("still serves the list when onExposure throws", async () => {
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      plugins: [
        interleavePlugin({
          onExposure: () => {
            throw new Error("analytics down");
          },
        }),
      ],
    });
    gb.initSync({ payload: payload() });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await interleave(gb, {
      ranker: "search",
      getList,
      fallbackConfig,
    });
    expect(res.inExperiment).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    gb.destroy();
  });

  it("works on scoped instances of a multi-user client", async () => {
    const onExposure = jest.fn();
    const client = new GrowthBookClient({
      plugins: [interleavePlugin({ onExposure })],
    });
    client.initSync({ payload: payload() });
    const user = client.createScopedInstance({ attributes: { id: "u2" } });
    const res = await interleave(user, {
      ranker: "search",
      getList,
      fallbackConfig,
    });
    expect(res.inExperiment).toBe(true);
    expect(onExposure.mock.calls[0][0].hashValue).toBe("u2");
    client.destroy();
  });

  it("hashes with an attribute that only globalAttributes supplies", async () => {
    const onExposure = jest.fn();
    const client = new GrowthBookClient({
      globalAttributes: { id: "global-user" },
      plugins: [interleavePlugin({ onExposure })],
    });
    client.initSync({ payload: payload() });
    const user = client.createScopedInstance({ attributes: {} });
    const res = await interleave(user, {
      ranker: "search",
      getList,
      fallbackConfig,
    });
    expect(res.inExperiment).toBe(true);
    expect(onExposure.mock.calls[0][0].hashValue).toBe("global-user");
    client.destroy();
  });

  it("still serves the list when a scoped eventLogger throws", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const client = new GrowthBookClient({
      eventLogger: () => {
        throw new Error("analytics down");
      },
      plugins: [interleavePlugin()],
    });
    client.initSync({ payload: payload() });
    const user = client.createScopedInstance({ attributes: { id: "u2" } });
    const res = await interleave(user, {
      ranker: "search",
      getList,
      fallbackConfig,
    });
    expect(res.inExperiment).toBe(true);
    expect(res.result.length).toBeGreaterThan(0);
    client.destroy();
    spy.mockRestore();
  });

  it.each([
    ["interleaved", { id: "u1" }, undefined],
    ["a targeting miss", { id: "u1" }, { condition: { country: "US" } }],
    ["no hash attribute", {}, undefined],
  ])("caps the list at maxItems on %s", async (_label, attributes, rule) => {
    const { gb } = setup(attributes, rule);
    const res = await interleave(gb, {
      ranker: "search",
      getList,
      fallbackConfig,
      maxItems: 2,
    });
    expect(res.result.length).toBeLessThanOrEqual(2);
    gb.destroy();
  });

  it("hashes with attribute overrides", async () => {
    const { gb, onExposure } = setup();
    await gb.setAttributeOverrides({ id: "override" });
    await interleave(gb, { ranker: "search", getList, fallbackConfig });
    expect(onExposure.mock.calls[0][0].hashValue).toBe("override");
    gb.destroy();

    const scopedExposure = jest.fn();
    const client = new GrowthBookClient({
      plugins: [interleavePlugin({ onExposure: scopedExposure })],
    });
    client.initSync({ payload: payload() });
    const user = client.createScopedInstance({
      attributes: { id: "u2" },
      attributeOverrides: { id: "override" },
    });
    await interleave(user, { ranker: "search", getList, fallbackConfig });
    expect(scopedExposure.mock.calls[0][0].hashValue).toBe("override");
    client.destroy();
  });
});

describe("decryptPayload", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (global as any).TextDecoder = TextDecoder;

  it("decrypts encryptedInterleavings", async () => {
    const key = "Ns04T5n9+59rl2x3SlNHtQ==";
    const iv = randomBytes(16);
    const cipher = createCipheriv(
      "aes-128-cbc",
      Buffer.from(key, "base64"),
      iv,
    );
    const interleavings = payload().interleavings;
    const encrypted =
      iv.toString("base64") +
      "." +
      Buffer.concat([
        cipher.update(JSON.stringify(interleavings)),
        cipher.final(),
      ]).toString("base64");

    const data = await decryptPayload(
      { encryptedInterleavings: encrypted },
      key,
      webcrypto.subtle as SubtleCrypto,
    );
    expect(data.interleavings).toEqual(interleavings);
    expect(data.encryptedInterleavings).toBeUndefined();
  });
});
