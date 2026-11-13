import {
  getPhaseFromUrl,
  urlWithPhase,
} from "@/components/Experiment/phaseUrl";

describe("getPhaseFromUrl", () => {
  it("reads a 1-based phase number", () => {
    expect(getPhaseFromUrl("?phase=1", 3)).toBe(0);
    expect(getPhaseFromUrl("?phase=3", 3)).toBe(2);
  });

  it("ignores other params", () => {
    expect(getPhaseFromUrl("?foo=bar&phase=2", 3)).toBe(1);
  });

  it("returns null without a phase", () => {
    expect(getPhaseFromUrl("", 3)).toBeNull();
    expect(getPhaseFromUrl("?phase=", 3)).toBeNull();
  });

  it("returns null for phases the experiment doesn't have", () => {
    expect(getPhaseFromUrl("?phase=0", 3)).toBeNull();
    expect(getPhaseFromUrl("?phase=4", 3)).toBeNull();
    expect(getPhaseFromUrl("?phase=1", 0)).toBeNull();
  });

  it("returns null for values that aren't whole numbers", () => {
    expect(getPhaseFromUrl("?phase=abc", 3)).toBeNull();
    expect(getPhaseFromUrl("?phase=1.5", 3)).toBeNull();
    expect(getPhaseFromUrl("?phase=-1", 3)).toBeNull();
  });
});

describe("urlWithPhase", () => {
  const base = "https://app.growthbook.io/experiment/exp_123";

  it("adds an older phase, keeping the tab hash", () => {
    expect(urlWithPhase(`${base}#results`, 0, 3)).toBe(
      `${base}?phase=1#results`,
    );
  });

  it("replaces an existing phase", () => {
    expect(urlWithPhase(`${base}?phase=1#results`, 1, 3)).toBe(
      `${base}?phase=2#results`,
    );
  });

  it("drops the param for the latest phase", () => {
    expect(urlWithPhase(`${base}?phase=1#results`, 2, 3)).toBe(
      `${base}#results`,
    );
    expect(urlWithPhase(`${base}#results`, 2, 3)).toBe(`${base}#results`);
  });

  it("keeps other params", () => {
    expect(urlWithPhase(`${base}?foo=bar#results`, 0, 3)).toBe(
      `${base}?foo=bar&phase=1#results`,
    );
  });

  it("round-trips with getPhaseFromUrl", () => {
    const url = new URL(urlWithPhase(`${base}#results`, 1, 3));
    expect(getPhaseFromUrl(url.search, 3)).toBe(1);
  });
});
