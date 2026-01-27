import type { TestStatistic } from "../models/statistics";
import {
  RegressionAdjustedStatistic,
  RegressionAdjustedRatioStatistic,
  SampleMeanStatistic,
  ProportionStatistic,
  RatioStatistic,
} from "../models/statistics";

/**
 * Convert a CUPED-adjusted statistic back to its unadjusted form.
 * Used for generating supplemental results without CUPED adjustment.
 */
export function getCupedUnadjustedStat(stat: TestStatistic): TestStatistic {
  if (stat instanceof RegressionAdjustedStatistic) {
    const postStat = stat.postStatistic;
    if (postStat instanceof SampleMeanStatistic) {
      return new SampleMeanStatistic({
        n: postStat.n,
        sum: postStat.sum,
        sum_squares: postStat.sumSquares,
      });
    } else {
      return new ProportionStatistic({
        n: postStat.n,
        sum: (postStat as ProportionStatistic).sum,
      });
    }
  } else if (stat instanceof RegressionAdjustedRatioStatistic) {
    const mStatPost = stat.mStatisticPost;
    const dStatPost = stat.dStatisticPost;

    let mStatistic: SampleMeanStatistic | ProportionStatistic;
    if (mStatPost instanceof SampleMeanStatistic) {
      mStatistic = new SampleMeanStatistic({
        n: mStatPost.n,
        sum: mStatPost.sum,
        sum_squares: mStatPost.sumSquares,
      });
    } else {
      mStatistic = new ProportionStatistic({
        n: mStatPost.n,
        sum: (mStatPost as ProportionStatistic).sum,
      });
    }

    let dStatistic: SampleMeanStatistic | ProportionStatistic;
    if (dStatPost instanceof SampleMeanStatistic) {
      dStatistic = new SampleMeanStatistic({
        n: dStatPost.n,
        sum: dStatPost.sum,
        sum_squares: dStatPost.sumSquares,
      });
    } else {
      dStatistic = new ProportionStatistic({
        n: dStatPost.n,
        sum: (dStatPost as ProportionStatistic).sum,
      });
    }

    return new RatioStatistic({
      n: stat.n,
      m_statistic: mStatistic,
      d_statistic: dStatistic,
      m_d_sum_of_products: stat.mPostDPostSumOfProducts,
    });
  }

  return stat;
}
