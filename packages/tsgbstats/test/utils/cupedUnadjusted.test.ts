import { getCupedUnadjustedStat } from "../../src/utils/cupedUnadjusted";
import {
  RegressionAdjustedStatistic,
  RegressionAdjustedRatioStatistic,
  SampleMeanStatistic,
  ProportionStatistic,
  RatioStatistic,
} from "../../src/models/statistics";

describe("getCupedUnadjustedStat", () => {
  it("converts RegressionAdjustedStatistic with SampleMean to SampleMeanStatistic", () => {
    const postStatistic = new SampleMeanStatistic({
      n: 100,
      sum: 500,
      sum_squares: 3000,
    });
    const preStatistic = new SampleMeanStatistic({
      n: 100,
      sum: 450,
      sum_squares: 2500,
    });
    const stat = new RegressionAdjustedStatistic({
      n: 100,
      post_statistic: postStatistic,
      pre_statistic: preStatistic,
      post_pre_sum_of_products: 2700,
      theta: null,
    });

    const result = getCupedUnadjustedStat(stat);

    expect(result).toBeInstanceOf(SampleMeanStatistic);
    expect(result.n).toBe(100);
    expect((result as SampleMeanStatistic).sum).toBe(500);
    expect((result as SampleMeanStatistic).sumSquares).toBe(3000);
  });

  it("converts RegressionAdjustedStatistic with Proportion to ProportionStatistic", () => {
    const postStatistic = new ProportionStatistic({
      n: 100,
      sum: 75,
    });
    const preStatistic = new ProportionStatistic({
      n: 100,
      sum: 70,
    });
    const stat = new RegressionAdjustedStatistic({
      n: 100,
      post_statistic: postStatistic,
      pre_statistic: preStatistic,
      post_pre_sum_of_products: 60,
      theta: null,
    });

    const result = getCupedUnadjustedStat(stat);

    expect(result).toBeInstanceOf(ProportionStatistic);
    expect(result.n).toBe(100);
  });

  it("converts RegressionAdjustedRatioStatistic to RatioStatistic", () => {
    const mStatPost = new SampleMeanStatistic({
      n: 100,
      sum: 500,
      sum_squares: 3000,
    });
    const dStatPost = new SampleMeanStatistic({
      n: 100,
      sum: 200,
      sum_squares: 500,
    });
    const mStatPre = new SampleMeanStatistic({
      n: 100,
      sum: 450,
      sum_squares: 2500,
    });
    const dStatPre = new SampleMeanStatistic({
      n: 100,
      sum: 180,
      sum_squares: 400,
    });

    const stat = new RegressionAdjustedRatioStatistic({
      n: 100,
      m_statistic_post: mStatPost,
      d_statistic_post: dStatPost,
      m_statistic_pre: mStatPre,
      d_statistic_pre: dStatPre,
      m_post_m_pre_sum_of_products: 2700,
      d_post_d_pre_sum_of_products: 450,
      m_pre_d_pre_sum_of_products: 1000,
      m_post_d_post_sum_of_products: 1200,
      m_post_d_pre_sum_of_products: 1100,
      m_pre_d_post_sum_of_products: 900,
      theta: null,
    });

    const result = getCupedUnadjustedStat(stat);

    expect(result).toBeInstanceOf(RatioStatistic);
  });

  it("returns same stat if not regression adjusted", () => {
    const stat = new SampleMeanStatistic({
      n: 100,
      sum: 500,
      sum_squares: 3000,
    });
    const result = getCupedUnadjustedStat(stat);
    expect(result).toBe(stat);
  });
});
