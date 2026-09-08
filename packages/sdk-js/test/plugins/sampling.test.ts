import {
  shouldSampleScope,
  persistSampleDecision,
} from "../../src/plugins/utils/sampling";

const STORAGE_KEY = "gb_test_sample_decision";

describe("shouldSampleScope", () => {
  afterEach(() => {
    sessionStorage.removeItem(STORAGE_KEY);
  });

  it("always samples at rate 1 and never at rate 0", () => {
    expect(
      shouldSampleScope({ rate: 1, storageKey: STORAGE_KEY, scopeId: "a" }),
    ).toBe(true);
    sessionStorage.removeItem(STORAGE_KEY);
    expect(
      shouldSampleScope({ rate: 0, storageKey: STORAGE_KEY, scopeId: "a" }),
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
