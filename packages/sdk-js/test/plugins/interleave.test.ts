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
        hashAttribute: "id",
        seed: "il-seed",
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
  const draft = (
    a: string[],
    b: string[],
    first: 0 | 1 = 0,
    maxItems?: number,
  ) =>
    teamDraft(
      [
        { variation: "A", items: a },
        { variation: "B", items: b },
      ],
      (id) => id,
      () => first,
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

  it("fills a leftover maxItems slot non-competitively", () => {
    const { items, meta } = draft(["a", "b"], ["c", "d"], 0, 3);
    expect(items).toEqual(["a", "c", "b"]);
    expect(meta.map((m) => m.competitive)).toEqual([true, true, false]);
  });

  it("returns exactly maxItems when a tie makes the parity odd", () => {
    const a = ["x", "a1", "a2", "a3"];
    const b = ["x", "b1", "b2", "b3"];
    expect(draft(a, b, 0, 4).items).toEqual(["x", "a1", "b1", "a2"]);
  });

  it("stops at maxItems when not even one more item fits", () => {
    expect(draft(["x", "a"], ["x", "b"], 0, 1).items).toEqual(["x"]);
  });
});

describe("interleave", () => {
  it("drafts both rankers' lists and sends one exposure", async () => {
    const { gb, onExposure, eventLogger } = setup();
    const res = await interleave(gb, {
      key: "search",
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
        key: "search",
        getList,
        fallbackConfig,
        rankingId,
      });
    expect((await run("same")).result).toEqual((await run("same")).result);
    expect((await run("x")).rankingId).toBe("x");
    expect(
      (await interleave(gb, { key: "search", getList, fallbackConfig }))
        .rankingId,
    ).toEqual(expect.any(String));
    gb.destroy();
  });

  it("accepts an async getList and object items", async () => {
    const { gb } = setup();
    const res = await interleave(gb, {
      key: "search",
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
      key: "search",
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

  it("serves the first ranker and logs when the second one throws", async () => {
    const { gb, onExposure } = setup();
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const res = await interleave(gb, {
      key: "search",
      getList: (config) => {
        if (config.algorithm === "buyers-pick") throw new Error("boom");
        return getList(config);
      },
      fallbackConfig,
    });
    expect(res).toMatchObject({
      inExperiment: false,
      variation: "popular",
      trackingProps: {},
    });
    expect(res.result).toEqual(rankedLists.popular);
    expect(onExposure).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
    gb.destroy();
  });

  it("rethrows when the first ranker throws, since nothing is left to serve", async () => {
    const { gb, onExposure } = setup();
    await expect(
      interleave(gb, {
        key: "search",
        getList: (config) => {
          if (config.algorithm === "popular") throw new Error("boom");
          return getList(config);
        },
        fallbackConfig,
      }),
    ).rejects.toThrow("boom");
    expect(onExposure).not.toHaveBeenCalled();
    gb.destroy();
  });

  it("doesn't log an error per impression when only onExposure is configured", async () => {
    const onExposure = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      plugins: [interleavePlugin({ onExposure })],
    });
    gb.initSync({ payload: payload() });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await interleave(gb, { key: "search", getList, fallbackConfig });
    expect(onExposure).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    gb.destroy();
  });

  it("logs exposures in dev mode without requiring an eventLogger", async () => {
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      enableDevMode: true,
      plugins: [interleavePlugin()],
    });
    gb.initSync({ payload: payload() });
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await interleave(gb, { key: "search", getList, fallbackConfig });
    expect(gb.logs).toContainEqual(
      expect.objectContaining({ eventName: EVENT_INTERLEAVE_EXPOSURE }),
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    gb.destroy();
  });

  it("notifies custom event subscribers without requiring an eventLogger", async () => {
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      plugins: [interleavePlugin()],
    });
    gb.initSync({ payload: payload() });
    const subscriber = jest.fn();
    gb._subscribeCustomEvents(subscriber);
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await interleave(gb, { key: "search", getList, fallbackConfig });
    expect(subscriber).toHaveBeenCalledWith(
      EVENT_INTERLEAVE_EXPOSURE,
      expect.any(Object),
    );
    expect(spy).not.toHaveBeenCalled();
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
      key: "search",
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
      key: "search",
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
      key: "search",
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
      key: "search",
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
        key: "search",
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
      key: "search",
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
      key: "search",
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
      key: "search",
      getList,
      fallbackConfig,
    });
    expect(res.inExperiment).toBe(true);
    expect(onExposure.mock.calls[0][0].hashValue).toBe("u2");
    client.destroy();
  });

  it("logs scoped exposures in user dev mode without an eventLogger", async () => {
    const client = new GrowthBookClient({
      plugins: [interleavePlugin()],
    });
    client.initSync({ payload: payload() });
    const user = client.createScopedInstance({
      attributes: { id: "u2" },
      enableDevMode: true,
    });
    await interleave(user, { key: "search", getList, fallbackConfig });
    expect(user.logs).toContainEqual(
      expect.objectContaining({ eventName: EVENT_INTERLEAVE_EXPOSURE }),
    );
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
      key: "search",
      getList,
      fallbackConfig,
    });
    expect(res.inExperiment).toBe(true);
    expect(onExposure.mock.calls[0][0].hashValue).toBe("global-user");
    client.destroy();
  });

  it("still serves the list when a scoped eventLogger rejects", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    const client = new GrowthBookClient({
      eventLogger: () => Promise.reject(new Error("analytics down")),
      plugins: [interleavePlugin()],
    });
    client.initSync({ payload: payload() });
    const user = client.createScopedInstance({ attributes: { id: "u2" } });
    const res = await interleave(user, {
      key: "search",
      getList,
      fallbackConfig,
    });
    expect(res.inExperiment).toBe(true);
    // The rejection is handled on a later tick, so let it settle
    await Promise.resolve();
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
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
      key: "search",
      getList,
      fallbackConfig,
    });
    expect(res.inExperiment).toBe(true);
    expect(res.result.length).toBeGreaterThan(0);
    client.destroy();
    spy.mockRestore();
  });

  it.each([
    { label: "interleaved", attributes: { id: "u1" }, rule: undefined },
    {
      label: "a targeting miss",
      attributes: { id: "u1" },
      rule: { condition: { country: "US" } },
    },
    { label: "no hash attribute", attributes: {}, rule: undefined },
  ])("caps the list at maxItems on $label", async ({ attributes, rule }) => {
    const { gb } = setup(attributes, rule);
    const res = await interleave(gb, {
      key: "search",
      getList,
      fallbackConfig,
      maxItems: 2,
    });
    expect(res.result.length).toBeLessThanOrEqual(2);
    gb.destroy();
  });

  // Remote evaluation replaces the pseudo flag's rules with a forced
  // defaultValue, so the hash settings have to come off the interleaving itself.
  it("hashes on the definition's attribute when the payload has no rules", async () => {
    const onExposure = jest.fn();
    const gb = new GrowthBook({
      attributes: { device_id: "d1" },
      plugins: [interleavePlugin({ onExposure })],
    });
    gb.initSync({
      payload: {
        features: {
          "$interleave:search": { defaultValue: { interleave: true } },
        },
        interleavings: {
          search: {
            trackingKey: "search-tk",
            hashAttribute: "device_id",
            seed: "il-seed",
            variations: [
              { key: "popular", config: configs.popular },
              { key: "buyers-pick", config: configs["buyers-pick"] },
            ],
          },
        },
      },
    });
    const res = await interleave(gb, {
      key: "search",
      getList,
      fallbackConfig,
      rankingId: "r1",
    });

    expect(res.inExperiment).toBe(true);
    expect(onExposure.mock.calls[0][0]).toMatchObject({
      hashAttribute: "device_id",
      hashValue: "d1",
    });
    // Same seed as the rule-bearing payload, so the draft is identical
    const { gb: normal } = setup({ device_id: "d1", id: "u1" });
    const viaRules = await interleave(normal, {
      key: "search",
      getList,
      fallbackConfig,
      rankingId: "r1",
    });
    expect(res.result).toEqual(viaRules.result);

    gb.destroy();
    normal.destroy();
  });

  it("hashes with attribute overrides", async () => {
    const { gb, onExposure } = setup();
    await gb.setAttributeOverrides({ id: "override" });
    await interleave(gb, { key: "search", getList, fallbackConfig });
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
    await interleave(user, { key: "search", getList, fallbackConfig });
    expect(scopedExposure.mock.calls[0][0].hashValue).toBe("override");
    client.destroy();
  });

  it("emits the exposure shape the analysis layer reads", async () => {
    const { gb, onExposure } = setup();
    await interleave(gb, {
      key: "search",
      getList,
      fallbackConfig,
      rankingId: "r1",
    });

    const exposure: InterleaveExposure = onExposure.mock.calls[0][0];
    expect(Object.keys(exposure).sort()).toEqual([
      "experimentId",
      "hashAttribute",
      "hashValue",
      "items",
      "rankingId",
      "timestamp",
    ]);
    // experiment_id is matched against the interleaving's trackingKey
    expect(exposure.experimentId).toBe("search-tk");
    expect(exposure.rankingId).toBe("r1");

    for (const item of exposure.items) {
      expect(Object.keys(item).sort()).toEqual([
        "competitive",
        "itemId",
        "position",
        "variation",
      ]);
      expect(typeof item.itemId).toBe("string");
      // Matched against the ranker's key, not its id or index
      expect(["popular", "buyers-pick"]).toContain(item.variation);
      // Rendered as the text 'true'/'false' by every dialect's fieldText
      expect(typeof item.competitive).toBe("boolean");
    }

    // Analysis collapses with MAX(team) over (user, ranking, item), so an item
    // must never appear twice in one draft
    const ids = exposure.items.map((i) => i.itemId);
    expect(new Set(ids).size).toBe(ids.length);

    // "a" tops both lists, so it is a tie and must not be credited
    expect(exposure.items.find((i) => i.itemId === "a")?.competitive).toBe(
      false,
    );

    // Each ranker gets the same number of competitive items, which is what
    // makes the paired denominator a fair comparison
    const competitive = exposure.items.filter((i) => i.competitive);
    expect(competitive.length).toBeGreaterThan(0);
    expect(competitive.filter((i) => i.variation === "popular").length).toBe(
      competitive.filter((i) => i.variation === "buyers-pick").length,
    );
    gb.destroy();
  });

  // qaMode and `enabled: false` gate runExperiment, which the pseudo flag's
  // forced rule never reaches — a QA user drafted here would emit a real
  // exposure and be counted in the analysis denominators.
  it.each([
    { label: "qaMode", opts: { qaMode: true } },
    { label: "enabled false", opts: { enabled: false } },
  ])("does not interleave or track under $label", async ({ opts }) => {
    const onExposure = jest.fn();
    const eventLogger = jest.fn();
    const gb = new GrowthBook({
      attributes: { id: "u1" },
      eventLogger,
      plugins: [interleavePlugin({ onExposure })],
      ...opts,
    });
    gb.initSync({ payload: payload() });

    const res = await interleave(gb, {
      key: "search",
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
    expect(eventLogger).not.toHaveBeenCalled();
    gb.destroy();
  });

  it.each([
    { label: "the client", clientOpts: { qaMode: true }, userOpts: {} },
    { label: "the user context", clientOpts: {}, userOpts: { qaMode: true } },
  ])(
    "does not interleave when $label sets qaMode on a scoped instance",
    async ({ clientOpts, userOpts }) => {
      const onExposure = jest.fn();
      const client = new GrowthBookClient({
        plugins: [interleavePlugin({ onExposure })],
        ...clientOpts,
      });
      client.initSync({ payload: payload() });
      const user = client.createScopedInstance({
        attributes: { id: "u2" },
        ...userOpts,
      });

      const res = await interleave(user, {
        key: "search",
        getList,
        fallbackConfig,
      });

      expect(res.inExperiment).toBe(false);
      expect(onExposure).not.toHaveBeenCalled();
      client.destroy();
    },
  );

  it("keeps one impression across pages when rankingId is reused", async () => {
    const { gb, onExposure } = setup();
    const page = (maxItems: number) =>
      interleave(gb, {
        key: "search",
        getList,
        fallbackConfig,
        rankingId: "r-page",
        maxItems,
      });

    const first = await page(3);
    const second = await page(6);

    // The draft is extended, not re-rolled
    expect(second.result.slice(0, first.result.length)).toEqual(first.result);
    // Both exposures carry the same id, which is what lets analysis collapse
    // them into a single impression rather than counting two
    expect(onExposure).toHaveBeenCalledTimes(2);
    expect(
      onExposure.mock.calls.map((c) => (c[0] as InterleaveExposure).rankingId),
    ).toEqual(["r-page", "r-page"]);
    gb.destroy();
  });
});

describe("decryptPayload", () => {
  // jsdom provides no TextDecoder, which decryptPayload needs
  Object.defineProperty(globalThis, "TextDecoder", {
    value: TextDecoder,
    writable: true,
    configurable: true,
  });

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

describe("reducePayload with interleavings", () => {
  const scoped = (metadata?: Record<string, unknown>): FeatureApiResponse => {
    const base = payload();
    return {
      ...base,
      features: {
        "$interleave:search": {
          ...base.features!["$interleave:search"],
          ...(metadata ? { metadata } : {}),
        },
      },
    };
  };

  it("drops a definition whose flag the project filter removed", () => {
    const client = new GrowthBookClient();
    client.initSync({ payload: scoped({ projects: ["proj-a"] }) });
    const reduced = client.reducePayload({
      userContext: { attributes: { id: "u1" } },
      include: { projects: ["proj-b"] },
    });
    expect(reduced.features?.["$interleave:search"]).toBeUndefined();
    expect(reduced.interleavings).toEqual({});
    client.destroy();
  });

  it("keeps a definition whose flag survived", () => {
    const client = new GrowthBookClient();
    client.initSync({ payload: scoped({ projects: ["proj-a"] }) });
    const reduced = client.reducePayload({
      userContext: { attributes: { id: "u1" } },
      include: { projects: ["proj-a"] },
    });
    expect(reduced.features?.["$interleave:search"]).toBeDefined();
    expect(Object.keys(reduced.interleavings || {})).toEqual(["search"]);
    client.destroy();
  });
});
