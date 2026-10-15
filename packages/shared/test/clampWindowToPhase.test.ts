import { clampWindowToPhase } from "../src/experiments";

describe("clampWindowToPhase", () => {
  const window = {
    startDate: new Date("2026-10-01T00:00:00Z"),
    endDate: new Date("2026-10-15T00:00:00Z"),
  };
  const phases = [
    { dateStarted: "2026-09-20T00:00:00Z", dateEnded: "2026-10-05T00:00:00Z" },
    { dateStarted: "2026-10-05T00:00:00Z" },
  ];

  it("starts at the phase start when the window reaches further back", () => {
    expect(clampWindowToPhase(window, { phases }, 1)).toEqual({
      startDate: new Date("2026-10-05T00:00:00Z"),
      endDate: window.endDate,
    });
  });

  it("ends at the phase end for an ended phase", () => {
    expect(clampWindowToPhase(window, { phases }, 0)).toEqual({
      startDate: window.startDate,
      endDate: new Date("2026-10-05T00:00:00Z"),
    });
  });

  it("leaves a window already inside the phase alone", () => {
    const inside = {
      startDate: new Date("2026-10-10T00:00:00Z"),
      endDate: new Date("2026-10-12T00:00:00Z"),
    };
    expect(clampWindowToPhase(inside, { phases }, 1)).toEqual(inside);
  });

  it("leaves single-phase experiments alone", () => {
    expect(clampWindowToPhase(window, { phases: [phases[1]] }, 0)).toEqual(
      window,
    );
  });

  it("leaves holdouts alone", () => {
    expect(clampWindowToPhase(window, { type: "holdout", phases }, 1)).toEqual(
      window,
    );
  });

  it("can return an empty window when the phase is outside it", () => {
    const before = {
      startDate: new Date("2026-09-01T00:00:00Z"),
      endDate: new Date("2026-09-10T00:00:00Z"),
    };
    const clamped = clampWindowToPhase(before, { phases }, 1);
    expect(clamped.startDate >= clamped.endDate).toBe(true);
  });
});
