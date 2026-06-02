import { N_STAR_VALUES } from "back-end/src/services/experimentQueries/constants";

export function getQuantileBoundsFromQueryResponse(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  row: Record<string, any>,
  prefix: string,
): Record<string, number> {
  // Finds the lower and upper bounds that correspond to the largest
  // nstar that is smaller than the actual quantile n
  const quantileData: {
    [key: string]: number;
  } = {};
  if (row[`${prefix}quantile`] !== undefined) {
    const rawQuantile = row[`${prefix}quantile`];

    quantileData[`${prefix}quantile`] = parseFloat(rawQuantile) || 0;
    quantileData[`${prefix}quantile_n`] =
      parseFloat(row[`${prefix}quantile_n`]) || 0;

    const smallestNStar = Math.min(...N_STAR_VALUES);

    // For datasources that we can pack the values in a single array column
    const gridArray = row[`${prefix}quantile_grid`];
    const isArrayGrid = Array.isArray(gridArray);
    const expectedGridLength = N_STAR_VALUES.length * 2;
    // BigQuery translates NULL arrays to empty arrays in query results, so
    // the no-values grid can/will arrive as []
    const emptyGridWithoutValues =
      isArrayGrid &&
      gridArray.length === 0 &&
      (rawQuantile ?? null) === null &&
      quantileData[`${prefix}quantile_n`] === 0;
    if (
      isArrayGrid &&
      gridArray.length !== expectedGridLength &&
      !emptyGridWithoutValues
    ) {
      throw new Error(
        `Expected ${prefix}quantile_grid array of length ${expectedGridLength}, got ${gridArray.length}. ` +
          `This indicates a mismatch between SQL generation (getQuantileGridColumns / getQuantileSketchGridColumns) ` +
          `and N_STAR_VALUES on the read side.`,
      );
    }

    const getLower = isArrayGrid
      ? (k: number) => gridArray[2 * k]
      : (k: number) => row[`${prefix}quantile_lower_${N_STAR_VALUES[k]}`];
    const getUpper = isArrayGrid
      ? (k: number) => gridArray[2 * k + 1]
      : (k: number) => row[`${prefix}quantile_upper_${N_STAR_VALUES[k]}`];

    N_STAR_VALUES.forEach((n, k) => {
      const lowerVal = getLower(k);
      const upperVal = getUpper(k);
      // Covers both null (e.g. empty-group APPROX_QUANTILES array elements)
      // and undefined (missing scalar columns)
      if ((lowerVal ?? null) === null || (upperVal ?? null) === null) return;

      if (
        // if nstar is smaller, or if it's the smallest nstar, proceed
        (n < quantileData[`${prefix}quantile_n`] || n == smallestNStar) &&
        // if N_STAR_VALUES isn't ascending need to make sure
        // this n is the largest n we've seen so far
        n > (Number(quantileData[`${prefix}quantile_nstar`]) || 0)
      ) {
        quantileData[`${prefix}quantile_lower`] = parseFloat(lowerVal) || 0;
        quantileData[`${prefix}quantile_upper`] = parseFloat(upperVal) || 0;
        quantileData[`${prefix}quantile_nstar`] = n;
      }
    });
  }
  return quantileData;
}
