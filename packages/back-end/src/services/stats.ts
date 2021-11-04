import { jStat } from "jstat";
import { MetricInterface, MetricStats } from "../../types/metric";
import { PythonShell } from "python-shell";
import { promisify } from "util";

export interface ABTestStats {
  expected: number;
  chanceToWin: number;
  uplift?: {
    dist: string;
    mean?: number;
    stddev?: number;
  };
  ci: [number, number];
  risk?: [number, number];
  buckets: {
    x: number;
    y: number;
  }[];
}

/**
 * Calculates a combined standard deviation of two sets of data
 */
function correctStddev(
  n: number,
  x: number,
  sx: number,
  m: number,
  y: number,
  sy: number
) {
  const s2x = Math.pow(sx, 2);
  const s2y = Math.pow(sy, 2);
  const t = n + m;

  // From https://math.stackexchange.com/questions/2971315/how-do-i-combine-standard-deviations-of-two-groups
  return Math.sqrt(
    ((n - 1) * s2x + (m - 1) * s2y) / (t - 1) +
      (n * m * Math.pow(x - y, 2)) / (t * (t - 1))
  );
}

/**
 * This combines two sets of count/mean/stddev into one
 * using the necessary statistical corrections
 */
export function mergeMetricStats(a: MetricStats, b: MetricStats): MetricStats {
  // Need to make sure there are enough data points to avoid divide by zero errors
  if (a.count + b.count <= 1) {
    return {
      count: 0,
      mean: 0,
      stddev: 0,
    };
  }

  const newStdDev = correctStddev(
    a.count,
    a.mean,
    a.stddev,
    b.count,
    b.mean,
    b.stddev
  );

  return {
    count: a.count + b.count,
    mean: (a.count * a.mean + b.count * b.mean) / (a.count + b.count),
    stddev: newStdDev,
  };
}

/**
 * This takes a mean/stddev from only converted users and
 * adjusts them to include non-converted users
 */
export function getAdjustedStats(stats: MetricStats, users: number) {
  const x = stats.mean;
  const sX = stats.stddev;
  const c = stats.count;
  const n = users;

  // Need to make sure there are enough data points to avoid divide by zero errors
  if (n <= 1) {
    return {
      mean: 0,
      stddev: 0,
    };
  }

  const mean = (x * c) / n;

  const varX = Math.pow(sX, 2);

  // From https://math.stackexchange.com/questions/2971315/how-do-i-combine-standard-deviations-of-two-groups
  const stddev = Math.sqrt(
    ((c - 1) * varX) / (n - 1) + (c * (n - c) * Math.pow(x, 2)) / (n * (n - 1))
  );

  return {
    mean,
    stddev,
  };
}

export async function abtest(
  metric: MetricInterface,
  aUsers: number,
  aStats: MetricStats,
  bUsers: number,
  bStats: MetricStats
): Promise<ABTestStats> {
  if (metric.ignoreNulls) {
    aUsers = aStats.count;
    bUsers = bStats.count;
  } else {
    aStats = {
      ...aStats,
      ...getAdjustedStats(aStats, aUsers),
    };

    bStats = {
      ...bStats,
      ...getAdjustedStats(bStats, bUsers),
    };
  }

  // Don't call the stats engine if the input data is invalid
  // This avoids divide by zero errors and square roots of negatives
  let validData = true;
  if (metric.type !== "binomial") {
    if (aStats.stddev <= 0 || bStats.stddev <= 0) {
      validData = false;
    } else if (aUsers <= 1 || bUsers <= 1) {
      validData = false;
    }
  } else {
    if (aStats.count < 1 || bStats.count < 1) {
      validData = false;
    }
  }
  if (!validData) {
    return {
      expected: 0,
      chanceToWin: 0,
      ci: [0, 0],
      risk: [0, 0],
      uplift: {
        dist: "lognormal",
        mean: 0,
        stddev: 0,
      },
      buckets: [],
    };
  }

  const func =
    metric.type === "binomial" ? "binomial_ab_test" : "gaussian_ab_test";

  const args =
    metric.type === "binomial"
      ? "x_a=xa, n_a=na, x_b=xb, n_b=nb"
      : "m_a=ma, s_a=sa, n_a=na, m_b=mb, s_b=sb, n_b=nb";

  const result = await promisify(PythonShell.runString)(
    `
from gbstats.bayesian.main import ${func}
import json

data = json.loads("""${JSON.stringify({
      users: [aUsers, bUsers],
      count: [aStats.count, bStats.count],
      mean: [aStats.mean, bStats.mean],
      stddev: [aStats.stddev, bStats.stddev],
    })}""", strict=False)

xa, xb = data['count']
na, nb = data['users']
ma, mb = data['mean']
sa, sb = data['stddev']

print(json.dumps(${func}(${args})))`,
    {}
  );

  let parsed: {
    chance_to_win: number;
    expected: number;
    ci: [number, number];
    risk: [number, number];
    uplift: {
      dist: string;
      mean?: number;
      stddev?: number;
    };
  };
  try {
    parsed = JSON.parse(result?.[0]);
  } catch (e) {
    console.error("Failed to run stats model", result);
    throw e;
  }

  return {
    expected: parsed.expected,
    chanceToWin: metric.inverse
      ? 1 - parsed.chance_to_win
      : parsed.chance_to_win,
    ci: parsed.ci,
    risk: parsed.risk,
    uplift: parsed.uplift,
    buckets: [],
  };
}

export function getValueCR(
  metric: MetricInterface,
  value: number,
  count: number,
  users: number
) {
  const base = metric.ignoreNulls ? count : users;
  return {
    value,
    users: base,
    cr: base > 0 ? value / base : 0,
  };
}

// Sample Ratio Mismatch test
export function srm(users: number[], weights: number[]): number {
  // Convert count of users into ratios
  let totalObserved = 0;
  users.forEach((o) => {
    totalObserved += o;
  });
  if (totalObserved <= 1) {
    return 1;
  }

  let x = 0;
  users.forEach((o, i) => {
    const e = weights[i] * totalObserved;
    x += e ? Math.pow(o - e, 2) / e : 0;
  });

  return 1 - jStat.chisquare.cdf(x, users.length - 1) || 0;
}
