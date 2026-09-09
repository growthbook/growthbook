import {
  _resetSampleDecisionsForTests,
  DEFAULT_SAMPLING_SEED,
  shouldSample,
  shouldSampleScope,
  persistSampleDecision,
} from "../../src/plugins/utils/sampling";

const STORAGE_KEY = "gb_test_sample_decision";

describe("shouldSample", () => {
  it("nests cohorts sampled under one seed, so a 10% user is also a 25% user", () => {
    let inSmall = 0;
    for (let i = 0; i < 2000; i++) {
      const attributes = { id: `user-${i}` };
      const small = shouldSample({
        rate: 0.1,
        hashAttribute: "id",
        attributes,
        seed: DEFAULT_SAMPLING_SEED,
      });
      const large = shouldSample({
        rate: 0.25,
        hashAttribute: "id",
        attributes,
        seed: DEFAULT_SAMPLING_SEED,
      });
      if (small) {
        inSmall++;
        expect(large).toBe(true);
      }
    }
    expect(inSmall).toBeGreaterThan(100);
  });
});

describe("shouldSampleScope", () => {
  beforeEach(() => _resetSampleDecisionsForTests());

  it("keeps the decision in memory when sessionStorage loses it", () => {
    const random = jest.fn().mockReturnValue(0.9);
    expect(
      shouldSampleScope({
        rate: 0.5,
        storageKey: STORAGE_KEY,
        scopeId: "s1",
        random,
      }),
    ).toBe(false);
    sessionStorage.clear();
    random.mockReturnValue(0.1);
    expect(
      shouldSampleScope({
        rate: 0.5,
        storageKey: STORAGE_KEY,
        scopeId: "s1",
        random,
      }),
    ).toBe(false);
  });

  afterEach(() => {
    sessionStorage.removeItem(STORAGE_KEY);
  });

  it("always samples at rate 1 and never at rate 0", () => {
    expect(
      shouldSampleScope({ rate: 1, storageKey: STORAGE_KEY, scopeId: "a" }),
    ).toBe(true);
    expect(
      shouldSampleScope({ rate: 0, storageKey: STORAGE_KEY, scopeId: "b" }),
    ).toBe(false);
  });

  it("rolls once per scope and sticks, even if the rate changes", () => {
    const inRoll = () => 0.2;
    const outRoll = () => 0.9;

    expect(
      shouldSampleScope({
        rate: 0.5,
        storageKey: STORAGE_KEY,
        scopeId: "scope-1",
        random: inRoll,
      }),
    ).toBe(true);

    // Same scope: stored decision wins over a new (out-of-sample) roll and
    // over a lowered rate
    expect(
      shouldSampleScope({
        rate: 0.1,
        storageKey: STORAGE_KEY,
        scopeId: "scope-1",
        random: outRoll,
      }),
    ).toBe(true);
  });

  it("re-rolls for a new scope", () => {
    expect(
      shouldSampleScope({
        rate: 0.5,
        storageKey: STORAGE_KEY,
        scopeId: "scope-1",
        random: () => 0.2,
      }),
    ).toBe(true);

    expect(
      shouldSampleScope({
        rate: 0.5,
        storageKey: STORAGE_KEY,
        scopeId: "scope-2",
        random: () => 0.9,
      }),
    ).toBe(false);
  });

  it("honors an explicitly persisted decision", () => {
    persistSampleDecision(STORAGE_KEY, "forced-scope", true);

    expect(
      shouldSampleScope({
        rate: 0,
        storageKey: STORAGE_KEY,
        scopeId: "forced-scope",
      }),
    ).toBe(true);
  });
});
