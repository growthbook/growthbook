import {
  buildDisplayRepresentatives,
  quantizeByDisplay,
  normalizeValues,
} from "@/ui/Heatmap";

// Whole-percent formatter matching the Heatmap default; several raw values can
// round to the same displayed string (e.g. 0.1666 and 0.1667 both show "17%").
const pct = (value: number): string =>
  new Intl.NumberFormat(undefined, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);

const representativesFor = (values: (number | null)[]): Map<string, number> =>
  buildDisplayRepresentatives(values, pct);

const quantize = (values: (number | null)[]): (number | null)[] =>
  quantizeByDisplay(values, pct, representativesFor(values));

describe("buildDisplayRepresentatives", () => {
  it("maps each displayed string to the first value that formats to it", () => {
    const reps = representativesFor([0.1667, 0.1666, 0.2]);
    expect([...reps.entries()]).toEqual([
      ["17%", 0.1667],
      ["20%", 0.2],
    ]);
  });

  it("ignores null and NaN values", () => {
    const reps = representativesFor([null, Number.NaN, 0.5]);
    expect([...reps.entries()]).toEqual([["50%", 0.5]]);
  });

  it("is empty when there are no numeric values", () => {
    expect(representativesFor([null, Number.NaN]).size).toBe(0);
  });
});

describe("quantizeByDisplay", () => {
  it("collapses rounded-equal values onto a single representative", () => {
    // 0.1666 and 0.1667 both display as "17%", so both resolve to the first one.
    expect(quantize([0.1667, 0.1666, 0.1667, 0.1666])).toEqual([
      0.1667, 0.1667, 0.1667, 0.1667,
    ]);
  });

  it("keeps distinct displayed values distinct", () => {
    expect(quantize([0.1, 0.11, 0.1])).toEqual([0.1, 0.11, 0.1]);
  });

  it("passes null and NaN through unchanged", () => {
    // Distinct displayed values ("10%" vs "20%") so neither is collapsed.
    const values = [0.1, null, Number.NaN, 0.2];
    expect(quantize(values)).toEqual([0.1, null, Number.NaN, 0.2]);
  });

  it("falls back to the original value when no representative exists", () => {
    // An empty representative map (e.g. a value not seen when it was built).
    expect(quantizeByDisplay([0.5], pct, new Map())).toEqual([0.5]);
  });
});

describe("normalizeValues", () => {
  it("returns 0 for every cell when the values are equal (zero range)", () => {
    expect(normalizeValues([0.1667, 0.1667, 0.1667])).toEqual([0, 0, 0]);
  });

  it("returns null for every cell when there are no numeric values", () => {
    expect(normalizeValues([null, Number.NaN])).toEqual([null, null]);
  });

  it("min-max normalizes within the row by default", () => {
    expect(normalizeValues([10, 20, 30])).toEqual([0, 0.5, 1]);
  });

  it("preserves nulls while normalizing the numeric cells", () => {
    expect(normalizeValues([10, null, 30])).toEqual([0, null, 1]);
  });

  it("normalizes against provided bounds instead of the row min/max", () => {
    expect(normalizeValues([1, 2], { min: 0, max: 4 })).toEqual([0.25, 0.5]);
  });
});

describe('shared representatives across the grid (normalize="all")', () => {
  // Regression: equal displayed values must get equal shading. Two rows that
  // both read "10%, 11%" should normalize identically, even though their raw
  // values differ below display precision.
  it("gives rows with equal displayed values equal normalized intensities", () => {
    const rowA = [0.1, 0.11];
    const rowB = [0.104, 0.106];
    const allValues = [...rowA, ...rowB];

    // One representative map shared by the bounds pass and every row.
    const representatives = buildDisplayRepresentatives(allValues, pct);

    const quantizedAll = quantizeByDisplay(allValues, pct, representatives);
    const numeric = quantizedAll.filter(
      (v): v is number => v !== null && !Number.isNaN(v),
    );
    const bounds = { min: Math.min(...numeric), max: Math.max(...numeric) };

    const intensitiesA = normalizeValues(
      quantizeByDisplay(rowA, pct, representatives),
      bounds,
    );
    const intensitiesB = normalizeValues(
      quantizeByDisplay(rowB, pct, representatives),
      bounds,
    );

    expect(intensitiesA).toEqual([0, 1]);
    expect(intensitiesB).toEqual([0, 1]);
    expect(intensitiesA).toEqual(intensitiesB);
  });
});
