import { getPhaseFromUrl } from "@/components/Experiment/phaseUrl";

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
