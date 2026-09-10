import { getSampleChart } from "./sampleChart";

describe("getSampleChart", () => {
  it("groups numeric samples without treating missing values as zero", () => {
    const chart = getSampleChart(
      [
        { LATENCY: "20" },
        { LATENCY: 10 },
        { LATENCY: 20 },
        { LATENCY: 0 },
        { LATENCY: null },
        { LATENCY: "" },
        { LATENCY: "bad" },
        { LATENCY: Infinity },
      ],
      "latency",
      "timestamp",
    );
    expect(chart).toEqual({
      numeric: true,
      sampleSize: 4,
      labels: ["0–10", "10–20"],
      counts: [1, 3],
    });
  });
  it("groups event samples by UTC day in chronological order", () => {
    expect(
      getSampleChart(
        [
          { TIMESTAMP: "2026-09-10T23:30:00-07:00" },
          { TIMESTAMP: "2026-09-09T00:00:00Z" },
          { TIMESTAMP: "2026-09-11T12:00:00Z" },
          { TIMESTAMP: "invalid" },
        ],
        "$$count",
        "timestamp",
      ),
    ).toEqual({
      numeric: false,
      sampleSize: 3,
      labels: ["2026-09-09", "2026-09-11"],
      counts: [1, 2],
    });
  });
  it("does not substitute an unrelated field when the chosen column is absent", () => {
    expect(getSampleChart([{ other: 123 }], "latency", "timestamp")).toBeNull();
    expect(getSampleChart([], "$$count", "timestamp")).toBeNull();
  });
});
