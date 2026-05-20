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
    quantileData[`${prefix}quantile`] =
      parseFloat(row[`${prefix}quantile`]) || 0;
    quantileData[`${prefix}quantile_n`] =
      parseFloat(row[`${prefix}quantile_n`]) || 0;

    const smallestNStar = Math.min(...N_STAR_VALUES);

    // process grid for quantile data
    N_STAR_VALUES.forEach((n) => {
      const lowerColumn = `${prefix}quantile_lower_${n}`;
      const upperColumn = `${prefix}quantile_upper_${n}`;
      if (row[lowerColumn] === undefined || row[upperColumn] === undefined)
        return;

      if (
        // if nstar is smaller, or if it's the smallest nstar, proceed
        (n < quantileData[`${prefix}quantile_n`] || n == smallestNStar) &&
        // if N_STAR_VALUES isn't ascending need to make sure
        // this n is the largest n we've seen so far
        n > (Number(quantileData[`${prefix}quantile_nstar`]) || 0)
      ) {
        quantileData[`${prefix}quantile_lower`] =
          parseFloat(row[lowerColumn]) || 0;
        quantileData[`${prefix}quantile_upper`] =
          parseFloat(row[upperColumn]) || 0;
        quantileData[`${prefix}quantile_nstar`] = n;
      }
    });
  }
  return quantileData;
}
