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
 * This takes a mean/stddev from only converted users and
 * adjusts them to include non-converted users
 */
export function getAdjustedStats(stats: MetricStats, users: number) {
  const x = stats.mean;
  const sX = stats.stddev;
  const c = stats.count;
  const n = users;

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
    parsed = JSON.parse(result[0]);
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
  if (!totalObserved) {
    return 1;
  }

  let x = 0;
  users.forEach((o, i) => {
    const e = weights[i] * totalObserved;
    x += Math.pow(o - e, 2) / e;
  });

  return 1 - jStat.chisquare.cdf(x, users.length - 1) || 0;
}
