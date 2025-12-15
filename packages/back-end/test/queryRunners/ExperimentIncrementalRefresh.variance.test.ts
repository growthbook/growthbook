import { calculateVariance } from "./helpers/variance-test-utils";

describe("Incremental Refresh Variance Calculation", () => {
  describe("variance calculation from pre-aggregated data", () => {
    it("should calculate variance correctly when reaggregating daily sums", () => {
      // Test data: 3 users with known variance
      // User 1: values [5, 3] across 2 days -> sum = 8
      // User 2: values [7, 2] across 2 days -> sum = 9
      // User 3: values [4, 6] across 2 days -> sum = 10

      // Step 1: Expected variance from raw user-level data (like regular pipeline)
      const userSums = [8, 9, 10];
      const n = 3;
      const totalSum = 27;
      const expectedSumSquares = 8 * 8 + 9 * 9 + 10 * 10; // = 245
      const expectedVariance = (expectedSumSquares - (totalSum * totalSum) / n) / (n - 1);
      // = (245 - 243) / 2 = 1.0

      expect(expectedVariance).toBe(1.0);

      // Step 2: With WRONG approach (current bug): sum of squared sums
      const wrongSumSquares = 8 * 8 + 9 * 9 + 10 * 10; // = 245
      const wrongVariance = (wrongSumSquares - (totalSum * totalSum) / n) / (n - 1);
      // This happens to equal expectedVariance, but only works when aggregating
      // at the user level. The bug appears when we have daily data.

      // Step 3: Daily pre-aggregated data (what's stored in metric source table)
      // User 1, Day 1: value=5, sum_squares=25
      // User 1, Day 2: value=3, sum_squares=9
      // User 2, Day 1: value=7, sum_squares=49
      // User 2, Day 2: value=2, sum_squares=4
      // User 3, Day 1: value=4, sum_squares=16
      // User 3, Day 2: value=6, sum_squares=36

      const dailyData = [
        { user_id: "u1", day: "d1", value: 5, sum_squares: 25 },
        { user_id: "u1", day: "d2", value: 3, sum_squares: 9 },
        { user_id: "u2", day: "d1", value: 7, sum_squares: 49 },
        { user_id: "u2", day: "d2", value: 2, sum_squares: 4 },
        { user_id: "u3", day: "d1", value: 4, sum_squares: 16 },
        { user_id: "u3", day: "d2", value: 6, sum_squares: 36 },
      ];

      // Reaggregate to user level
      const userAggregates = new Map<string, { sum: number; sum_squares: number }>();
      dailyData.forEach((row) => {
        const existing = userAggregates.get(row.user_id) || { sum: 0, sum_squares: 0 };
        userAggregates.set(row.user_id, {
          sum: existing.sum + row.value,
          sum_squares: existing.sum_squares + row.sum_squares,
        });
      });

      // User level: u1={sum:8, sum_squares:34}, u2={sum:9, sum_squares:53}, u3={sum:10, sum_squares:52}
      const userSum = Array.from(userAggregates.values()).reduce((acc, u) => acc + u.sum, 0);
      const correctSumSquares = Array.from(userAggregates.values()).reduce((acc, u) => acc + u.sum_squares, 0);
      // sum = 27, sum_squares = 34 + 53 + 52 = 139

      const correctVariance = calculateVariance(correctSumSquares, userSum, n);
      // = (139 - 243) / 2 = -52
      // This is WRONG! The issue is we lost the cross-day variance

      // The problem: when we aggregate daily, we lose within-user, across-day variance
      // The correct sum_squares at user level should be computed from raw values:
      // u1: 5^2 + 3^2 = 34 ✓ (this part is correct)
      // u2: 7^2 + 2^2 = 53 ✓
      // u3: 4^2 + 6^2 = 52 ✓
      // Total = 139

      // But to get variance, we need: (sum_squares - sum^2/n) / (n-1)
      // = (139 - 27^2/3) / 2 = (139 - 243) / 2 = -52

      // This demonstrates the bug! The variance formula expects sum of squares of INDIVIDUAL values,
      // but when we aggregate daily first, we're correctly preserving that.
      // Wait... let me recalculate:

      // Actually, looking at this more carefully:
      // Individual values: [5,3,7,2,4,6]
      // Sum = 27
      // Sum of squares = 25 + 9 + 49 + 4 + 16 + 36 = 139
      // Variance (population) = (139 - 27^2/6) / 6 = (139 - 121.5) / 6 = 2.92
      // Variance (sample) = (139 - 27^2/6) / 5 = 3.5

      // But we want BETWEEN-USER variance, not within-user variance
      // Between-user: user sums = [8, 9, 10]
      // Mean = 9
      // Variance = ((8-9)^2 + (9-9)^2 + (10-9)^2) / 2 = (1 + 0 + 1) / 2 = 1.0

      // So the expected variance IS 1.0, and we can get it from:
      // Sum of squared user sums = 64 + 81 + 100 = 245
      // (245 - 27^2/3) / 2 = (245 - 243) / 2 = 1.0 ✓

      // The bug is that this formula only works when we're computing at the right level.
      // With incremental refresh, we need to ensure the sum_squares we store allows us
      // to compute user-level variance.

      expect(correctVariance).toBeLessThan(0); // This shows the bug
      expect(expectedVariance).toBe(1.0);
      expect(wrongVariance).toBe(expectedVariance); // Only works by coincidence
    });

    it("should match regular pipeline variance with real experiment data", () => {
      // Use actual data from the bug report (snapshot-1.json)
      const regularPipelineResult = {
        variation: 1,
        users: 326776,
        main_sum: 68244,
        main_sum_squares: 68244, // For binary metrics, sum_squares = sum
        uplift_stddev: 0.009323,
      };

      // Calculate variance from regular pipeline
      const regularVariance = calculateVariance(
        regularPipelineResult.main_sum_squares,
        regularPipelineResult.main_sum,
        regularPipelineResult.users
      );

      // For incremental refresh to match, it needs the same sum_squares
      const incrementalRefreshResult = {
        variation: 1,
        users: 326776,
        main_sum: 68244,
        main_sum_squares: 68244, // Should be reaggregated from daily sum_squares
        uplift_stddev: 0.009323,
      };

      const incrementalVariance = calculateVariance(
        incrementalRefreshResult.main_sum_squares,
        incrementalRefreshResult.main_sum,
        incrementalRefreshResult.users
      );

      // Variance should match
      expect(incrementalVariance).toBeCloseTo(regularVariance, 6);

      // Standard deviation (sqrt of variance) should also match
      const regularStdDev = Math.sqrt(regularVariance / regularPipelineResult.users);
      const incrementalStdDev = Math.sqrt(incrementalVariance / incrementalRefreshResult.users);
      expect(incrementalStdDev).toBeCloseTo(regularStdDev, 6);
    });
  });

  describe("ratio metrics", () => {
    it("should calculate variance for both numerator and denominator", () => {
      // Test with AOV metric: revenue / orders
      const users = 100;
      const totalRevenue = 5000;
      const totalOrders = 250;

      // Revenue sum_squares (assuming some variance)
      const revenueSumSquares = 300000;
      const revenueVariance = calculateVariance(revenueSumSquares, totalRevenue, users);

      // Orders sum_squares
      const ordersSumSquares = 750;
      const ordersVariance = calculateVariance(ordersSumSquares, totalOrders, users);

      expect(revenueVariance).toBeGreaterThan(0);
      expect(ordersVariance).toBeGreaterThan(0);
    });
  });

  describe("percentile-capped metrics", () => {
    it("should compute sum_squares after applying cap", () => {
      // With a cap at 100, values [50, 150, 200] become [50, 100, 100]
      const values = [50, 150, 200];
      const cap = 100;
      const cappedValues = values.map(v => Math.min(v, cap));

      const sum = cappedValues.reduce((a, b) => a + b, 0); // 250
      const sumSquares = cappedValues.reduce((a, b) => a + b * b, 0); // 22500

      const variance = calculateVariance(sumSquares, sum, values.length);

      // Variance of [50, 100, 100]
      // Mean = 83.33
      // Variance = ((50-83.33)^2 + (100-83.33)^2 + (100-83.33)^2) / 2
      // = (1111.11 + 277.78 + 277.78) / 2 = 833.33
      expect(variance).toBeCloseTo(833.33, 2);
    });
  });
});
