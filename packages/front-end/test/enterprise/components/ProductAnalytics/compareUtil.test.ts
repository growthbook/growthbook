import { alignComparisonOverlayToCategories } from "@/enterprise/components/ProductAnalytics/compareUtil";

describe("alignComparisonOverlayToCategories", () => {
  const seriesKeys = ["__single__"];

  it("maps comparison buckets by chronological rank when first dimension is date", () => {
    const comparisonDataMap = {
      __single__: {
        "2024-12-30": 10,
        "2024-12-31": 20,
        "2025-01-01": 30,
      },
    };
    const comparisonXValues = ["2024-12-31", "2025-01-01", "2024-12-30"];

    const sortedXValues = ["2025-01-02", "2025-01-03", "2025-01-04"];

    const aligned = alignComparisonOverlayToCategories(
      sortedXValues,
      comparisonDataMap,
      seriesKeys,
      comparisonXValues,
      true,
    );

    expect(aligned.__single__["2025-01-02"]).toBe(10);
    expect(aligned.__single__["2025-01-03"]).toBe(20);
    expect(aligned.__single__["2025-01-04"]).toBe(30);
  });

  it("preserves display order of categories while filling values from ranked comparison dates", () => {
    const comparisonDataMap = {
      __single__: {
        "2024-01-10": 100,
        "2024-01-05": 200,
      },
    };
    const sortedXValues = ["2025-01-08", "2025-01-03"];
    const aligned = alignComparisonOverlayToCategories(
      sortedXValues,
      comparisonDataMap,
      seriesKeys,
      ["2024-01-05", "2024-01-10"],
      true,
    );

    expect(aligned.__single__["2025-01-08"]).toBe(100);
    expect(aligned.__single__["2025-01-03"]).toBe(200);
  });

  it("aligns non-date dimensions by category key", () => {
    const comparisonDataMap = {
      __single__: {
        US: 42,
        UK: 7,
      },
    };
    const sortedXValues = ["UK", "US"];
    const aligned = alignComparisonOverlayToCategories(
      sortedXValues,
      comparisonDataMap,
      seriesKeys,
      ["US", "UK"],
      false,
    );

    expect(aligned.__single__.UK).toBe(7);
    expect(aligned.__single__.US).toBe(42);
  });

  it("uses zero when comparison has fewer date buckets than current", () => {
    const comparisonDataMap = {
      __single__: {
        "2024-01-01": 1,
      },
    };
    const sortedXValues = ["2025-01-01", "2025-01-02", "2025-01-03"];
    const aligned = alignComparisonOverlayToCategories(
      sortedXValues,
      comparisonDataMap,
      seriesKeys,
      ["2024-01-01"],
      true,
    );

    expect(aligned.__single__["2025-01-01"]).toBe(1);
    expect(aligned.__single__["2025-01-02"]).toBe(0);
    expect(aligned.__single__["2025-01-03"]).toBe(0);
  });
});
