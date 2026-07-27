import { decodeSQLResults, encodeSQLResults } from "shared/sql";
import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";
import { getQuantileBoundsFromQueryResponse } from "back-end/src/integrations/sql/columns/quantile-bounds-from-query-response";
import { processExperimentFactMetricsQueryRows } from "back-end/src/integrations/sql/processing/process-experiment-fact-metrics-query-rows";

// The array shape is the BigQuery-only optimization that packs the n_star CI
// grid into one column instead of N_STAR_VALUES.length * 2 scalar columns.
// It must be statistically equivalent to the legacy scalar shape — same
// "largest nstar smaller than actual n" selection.
describe("getQuantileBoundsFromQueryResponse — array vs scalar shape", () => {
  const prefix = "m0_";
  // Synthetic but realistic grid values: increasing CI width as nstar
  // shrinks. The actual numbers don't matter as long as both shapes carry
  // the same per-nstar lower/upper.
  const lowerFor = (n: number) => 0.9 - 1 / Math.sqrt(n);
  const upperFor = (n: number) => 0.9 + 1 / Math.sqrt(n);

  const buildScalarRow = (quantileN: number) => {
    const row: Record<string, number> = {
      [`${prefix}quantile`]: 0.9,
      [`${prefix}quantile_n`]: quantileN,
    };
    for (const nstar of N_STAR_VALUES) {
      row[`${prefix}quantile_lower_${nstar}`] = lowerFor(nstar);
      row[`${prefix}quantile_upper_${nstar}`] = upperFor(nstar);
    }
    return row;
  };

  const buildArrayRow = (quantileN: number) => {
    const arr: number[] = [];
    for (const nstar of N_STAR_VALUES) {
      arr.push(lowerFor(nstar), upperFor(nstar));
    }
    return {
      [`${prefix}quantile`]: 0.9,
      [`${prefix}quantile_n`]: quantileN,
      [`${prefix}quantile_grid`]: arr,
    };
  };

  it.each([100, 250, 1000, 50_000, 1_000_000, 100_000_000])(
    "picks identical bounds in array and scalar shape for quantile_n=%i",
    (quantileN) => {
      const scalar = getQuantileBoundsFromQueryResponse(
        buildScalarRow(quantileN),
        prefix,
      );
      const array = getQuantileBoundsFromQueryResponse(
        buildArrayRow(quantileN),
        prefix,
      );

      expect(array[`${prefix}quantile`]).toBe(scalar[`${prefix}quantile`]);
      expect(array[`${prefix}quantile_n`]).toBe(scalar[`${prefix}quantile_n`]);
      expect(array[`${prefix}quantile_nstar`]).toBe(
        scalar[`${prefix}quantile_nstar`],
      );
      expect(array[`${prefix}quantile_lower`]).toBe(
        scalar[`${prefix}quantile_lower`],
      );
      expect(array[`${prefix}quantile_upper`]).toBe(
        scalar[`${prefix}quantile_upper`],
      );
    },
  );

  it("returns empty object when no quantile data is present (both shapes)", () => {
    expect(getQuantileBoundsFromQueryResponse({}, prefix)).toEqual({});
    expect(
      getQuantileBoundsFromQueryResponse(
        { [`${prefix}quantile_grid`]: [] },
        prefix,
      ),
    ).toEqual({});
  });

  it("treats an empty grid array as no bounds when the quantile has no values", () => {
    const array = getQuantileBoundsFromQueryResponse(
      {
        [`${prefix}quantile`]: null,
        [`${prefix}quantile_n`]: 0,
        [`${prefix}quantile_grid`]: [],
      },
      prefix,
    );
    const scalar = getQuantileBoundsFromQueryResponse(
      {
        [`${prefix}quantile`]: null,
        [`${prefix}quantile_n`]: 0,
      },
      prefix,
    );

    expect(array).toEqual(scalar);
    expect(array[`${prefix}quantile_lower`]).toBe(0);
    expect(array[`${prefix}quantile_upper`]).toBe(0);
    expect(array[`${prefix}quantile_nstar`]).toBe(0);
  });

  it("defaults bounds to zero on sparse slices with a null packed grid", () => {
    const bounds = getQuantileBoundsFromQueryResponse(
      {
        [`${prefix}quantile`]: null,
        [`${prefix}quantile_n`]: 0,
        [`${prefix}quantile_grid`]: null,
      },
      prefix,
    );

    expect(bounds[`${prefix}quantile_lower`]).toBe(0);
    expect(bounds[`${prefix}quantile_upper`]).toBe(0);
    expect(bounds[`${prefix}quantile_nstar`]).toBe(0);
  });

  it("keeps zero bounds after chunked SQL result roundtrip for sparse slices", () => {
    const denseRow = {
      variation: "0",
      users: 100,
      m0_id: "fact_q",
      m0_quantile: 0.9,
      m0_quantile_n: 1000,
      m0_quantile_grid: N_STAR_VALUES.flatMap((nstar) => [
        0.9 - 1 / Math.sqrt(nstar),
        0.9 + 1 / Math.sqrt(nstar),
      ]),
    };
    const sparseRow = {
      variation: "1",
      users: 50,
      m0_id: "fact_q",
      m0_quantile: null,
      m0_quantile_n: 0,
      m0_quantile_grid: null,
    };

    const processed = processExperimentFactMetricsQueryRows([
      denseRow,
      sparseRow,
    ]);
    const [decodedSparse] = decodeSQLResults(encodeSQLResults(processed)).slice(
      1,
    );

    expect(decodedSparse.m0_quantile_lower).toBe(0);
    expect(decodedSparse.m0_quantile_upper).toBe(0);
    expect(decodedSparse.m0_quantile_nstar).toBe(0);
  });

  describe("collapsed-bounds fallback to a wider distinct nstar pair", () => {
    // At very high nstar the percentile offsets get so small that the sketch
    // resolves lower and upper to the same point. The selection must then fall
    // back to the tightest (largest) nstar that still has distinct bounds.
    const COLLAPSED = 0.9;
    // Build bounds where the top few nstar values collapse to a single point
    // and the rest stay distinct, controlled by a collapse threshold index.
    const buildCollapsingScalarRow = (
      quantileN: number,
      collapseFromIndex: number,
    ) => {
      const row: Record<string, number> = {
        [`${prefix}quantile`]: 0.9,
        [`${prefix}quantile_n`]: quantileN,
      };
      N_STAR_VALUES.forEach((nstar, k) => {
        if (k >= collapseFromIndex) {
          row[`${prefix}quantile_lower_${nstar}`] = COLLAPSED;
          row[`${prefix}quantile_upper_${nstar}`] = COLLAPSED;
        } else {
          row[`${prefix}quantile_lower_${nstar}`] = lowerFor(nstar);
          row[`${prefix}quantile_upper_${nstar}`] = upperFor(nstar);
        }
      });
      return row;
    };

    const buildCollapsingArrayRow = (
      quantileN: number,
      collapseFromIndex: number,
    ) => {
      const arr: number[] = [];
      N_STAR_VALUES.forEach((nstar, k) => {
        if (k >= collapseFromIndex) {
          arr.push(COLLAPSED, COLLAPSED);
        } else {
          arr.push(lowerFor(nstar), upperFor(nstar));
        }
      });
      return {
        [`${prefix}quantile`]: 0.9,
        [`${prefix}quantile_n`]: quantileN,
        [`${prefix}quantile_grid`]: arr,
      };
    };

    it.each(["scalar", "array"] as const)(
      "falls back to the largest distinct nstar pair (%s shape)",
      (shape) => {
        // quantile_n above the top nstar so selection lands on the largest
        // nstar, but the top two nstar pairs collapse — expect the third from
        // the top to be selected with its distinct bounds.
        const quantileN = Number.MAX_SAFE_INTEGER;
        const collapseFromIndex = N_STAR_VALUES.length - 2;
        const fallbackIndex = collapseFromIndex - 1;
        const fallbackNstar = N_STAR_VALUES[fallbackIndex];

        const row =
          shape === "scalar"
            ? buildCollapsingScalarRow(quantileN, collapseFromIndex)
            : buildCollapsingArrayRow(quantileN, collapseFromIndex);
        const bounds = getQuantileBoundsFromQueryResponse(row, prefix);

        expect(bounds[`${prefix}quantile_nstar`]).toBe(fallbackNstar);
        expect(bounds[`${prefix}quantile_lower`]).toBe(lowerFor(fallbackNstar));
        expect(bounds[`${prefix}quantile_upper`]).toBe(upperFor(fallbackNstar));
        expect(bounds[`${prefix}quantile_lower`]).not.toBe(
          bounds[`${prefix}quantile_upper`],
        );
      },
    );

    it.each(["scalar", "array"] as const)(
      "keeps collapsed bounds when every nstar pair collapses (%s shape)",
      (shape) => {
        const quantileN = Number.MAX_SAFE_INTEGER;
        // collapseFromIndex 0 => every pair is a single point
        const row =
          shape === "scalar"
            ? buildCollapsingScalarRow(quantileN, 0)
            : buildCollapsingArrayRow(quantileN, 0);
        const bounds = getQuantileBoundsFromQueryResponse(row, prefix);

        expect(bounds[`${prefix}quantile_lower`]).toBe(COLLAPSED);
        expect(bounds[`${prefix}quantile_upper`]).toBe(COLLAPSED);
        // Originally selected nstar is preserved (no invented bounds)
        expect(bounds[`${prefix}quantile_nstar`]).toBe(
          Math.max(...N_STAR_VALUES),
        );
      },
    );
  });

  it("throws when the grid array length does not match N_STAR_VALUES*2", () => {
    // Empty array — would silently drop all bounds without validation.
    expect(() =>
      getQuantileBoundsFromQueryResponse(
        {
          [`${prefix}quantile`]: 0.9,
          [`${prefix}quantile_n`]: 1000,
          [`${prefix}quantile_grid`]: [],
        },
        prefix,
      ),
    ).toThrow(/quantile_grid array of length/);

    // One element short — also a contract violation.
    const shortGrid = new Array(N_STAR_VALUES.length * 2 - 1).fill(0);
    expect(() =>
      getQuantileBoundsFromQueryResponse(
        {
          [`${prefix}quantile`]: 0.9,
          [`${prefix}quantile_n`]: 1000,
          [`${prefix}quantile_grid`]: shortGrid,
        },
        prefix,
      ),
    ).toThrow(/quantile_grid array of length/);
  });
});
