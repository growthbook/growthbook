import { jStat } from "jstat";
import { MetricInterface } from "../../types/metric";
import { MetricStats } from "../types/Integration";
import { PythonShell } from "python-shell";
import path from "path";
import { promisify } from "util";

export interface ABTestStats {
  expected: number;
  chanceToWin: number;
  hdi?: {
    dist: string;
    mean?: number;
    stddev?: number;
  };
  ci: [number, number];
  risk?: number;
  buckets: {
    x: number;
    y: number;
  }[];
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
      mean: (aStats.mean * aStats.count) / aUsers,
      stddev: (aStats.stddev * Math.sqrt(aStats.count)) / Math.sqrt(aUsers),
    };
    bStats = {
      ...bStats,
      mean: (bStats.mean * bStats.count) / bUsers,
      stddev: (bStats.stddev * Math.sqrt(bStats.count)) / Math.sqrt(bUsers),
    };
  }

  const options = {
    args: [
      metric.type,
      JSON.stringify({
        users: [aUsers, bUsers],
        count: [aStats.count, bStats.count],
        mean: [aStats.mean, bStats.mean],
        stddev: [aStats.stddev, bStats.stddev],
      }),
    ],
  };

  const script = path.join(__dirname, "..", "python", "bayesian", "main.py");

  const result = await promisify(PythonShell.run)(script, options);
  const parsed: {
    chance_to_win: number;
    expected: number;
    ci: [number, number];
    risk: number;
    hdi: {
      dist: string;
      mean?: number;
      stddev?: number;
    };
  } = JSON.parse(result[0]);

  return {
    expected: parsed.expected,
    chanceToWin: metric.inverse
      ? 1 - parsed.chance_to_win
      : parsed.chance_to_win,
    ci: parsed.ci,
    risk: parsed.risk,
    hdi: parsed.hdi,
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
