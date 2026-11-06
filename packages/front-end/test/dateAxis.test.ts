import { scaleTime } from "@visx/scale";
import { dateAxisTicks, spacedOut } from "@/components/Experiment/dateAxis";

const DAY = 24 * 60 * 60 * 1000;
const start = new Date("2024-01-01T00:00:00Z").getTime();
const scale = (days: number, width = 600) =>
  scaleTime({ domain: [start, start + days * DAY], range: [0, width] });

describe("dateAxisTicks", () => {
  it("labels as many dates as fit, by month over a long span", () => {
    const { ticks, format } = dateAxisTicks(scale(900), 360);
    expect(ticks.length).toBeLessThanOrEqual(5);
    expect(format(ticks[0])).toMatch(/^[A-Z][a-z]{2} \d{4}$/);
  });

  it("labels by day over weeks, and each point once there are that few", () => {
    expect(dateAxisTicks(scale(40), 600).format(new Date(start))).toMatch(
      /^[A-Z][a-z]{2} \d{1,2}$/,
    );
    const points = [0, 1, 2].map((d) => new Date(start + d * DAY));
    expect(dateAxisTicks(scale(2), 600, points).ticks).toBe(points);
  });
});

describe("spacedOut", () => {
  it("keeps events a gap apart, so a burst becomes one", () => {
    const burst = [0, 0.01, 0.02, 0.5, 1].map((d) => start + d * DAY);
    expect(spacedOut(burst, scale(1, 100), 10)).toEqual([
      burst[0],
      burst[3],
      burst[4],
    ]);
  });
});
