import { describe, expect, it } from "vitest";
import { placeChartAnnotations } from "@/enterprise/components/ProductAnalytics/chartAnnotations";

const days = ["2026-09-01", "2026-09-02", "2026-09-03"];
const weeks = ["2026-09-07", "2026-09-14", "2026-09-21"];
const note = (date: string) => ({ date, text: date });

describe("placeChartAnnotations", () => {
  it("puts a note on the bucket for its day", () => {
    expect(placeChartAnnotations([note("2026-09-02")], days)).toEqual([
      { bucket: "2026-09-02", text: "2026-09-02" },
    ]);
  });

  it("puts a mid-week note on the week that contains it", () => {
    expect(placeChartAnnotations([note("2026-09-17")], weeks)).toEqual([
      { bucket: "2026-09-14", text: "2026-09-17" },
    ]);
    expect(placeChartAnnotations([note("2026-09-27")], weeks)).toEqual([
      { bucket: "2026-09-21", text: "2026-09-27" },
    ]);
  });

  it("drops notes before or after the chart's range", () => {
    expect(placeChartAnnotations([note("2026-08-31")], days)).toEqual([]);
    expect(placeChartAnnotations([note("2026-09-04")], days)).toEqual([]);
    expect(placeChartAnnotations([note("2026-09-28")], weeks)).toEqual([]);
  });

  it("handles an empty chart and an unreadable date", () => {
    expect(placeChartAnnotations([note("2026-09-01")], [])).toEqual([]);
    expect(placeChartAnnotations([note("soon")], days)).toEqual([]);
  });
});
