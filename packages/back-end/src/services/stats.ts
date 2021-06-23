// eslint-disable-next-line
/// <reference path="../types/jstat.d.ts" />
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

// From: https://www.evanmiller.org/bayesian-ab-testing.html
function binomialChanceToWin(
  aSuccess: number,
  aFailure: number,
  bSuccess: number,
  bFailure: number
) {
  let total = 0;
  for (let i = 0; i < bSuccess; i++) {
    total += Math.exp(
      jStat.betaln(aSuccess + i + 1, bFailure + aFailure + 2) -
        Math.log(bFailure + i + 1) -
        jStat.betaln(1 + i, bFailure + 1) -
        jStat.betaln(aSuccess + 1, aFailure + 1)
    );
  }
  return total;
}
function countChanceToWin(
  aCount: number,
  aVisits: number,
  bCount: number,
  bVisits: number
) {
  let total = 0;
  for (let k = 0; k < bCount; k++) {
    total += Math.exp(
      k * Math.log(bVisits) +
        aCount * Math.log(aVisits) -
        (k + aCount) * Math.log(bVisits + aVisits) -
        Math.log(k + aCount) -
        jStat.betaln(k + 1, aCount)
    );
  }
  return total;
}

function abTest(
  sampleA: () => number,
  sampleB: () => number,
  chanceToWin: number | null,
  expected: number
): ABTestStats {
  const NUM_SAMPLES = 1e5;

  // Simulate the distributions a bunch of times to get a list of percent changes
  const change: number[] = Array(NUM_SAMPLES);
  let wins = 0;
  for (let i = 0; i < NUM_SAMPLES; i++) {
    const a = sampleA();
    const b = sampleB();
    change[i] = (b - a) / a;
    if (change[i] > 0) wins++;
  }
  change.sort((a, b) => {
    return a - b;
  });

  const simulatedCI: [number, number] = [
    change[Math.floor(change.length * 0.025)],
    change[Math.floor(change.length * 0.975)],
  ];

  let ci: [number, number];

  // Using the simulation for chanceToWin and the CI
  if (chanceToWin === null) {
    chanceToWin = wins / NUM_SAMPLES;
    ci = simulatedCI;
  }
  // If chanceToWin was calculated using a Bayesian formula
  else {
    // If it's close to significance, estimate the CI from the chanceToWin, otherwise, use the simulation data for the CI.
    // This is a hacky fix for when the simulation CI crosses zero even though chanceToWin is significant.
    // The bug happens because the CI and chanceToWin are calculated using different methods and don't always 100% agree.
    // A better fix is to calculate a Bayesian credible interval instead of using a frequentist Confidence Interval
    if (
      (chanceToWin > 0.7 && chanceToWin < 0.99) ||
      (chanceToWin < 0.3 && chanceToWin > 0.01)
    ) {
      ci = getCIFromChanceToWin(chanceToWin, expected);
    } else {
      ci = simulatedCI;
    }
  }

  return {
    ci,
    expected,
    buckets: [],
    chanceToWin,
  };
}

function getCIFromChanceToWin(
  chanceToWin: number,
  percentImprovement: number
): [number, number] {
  const alpha = 0.05;

  const a = jStat.normal.inv(1 - chanceToWin, 0, 1);
  const b = jStat.normal.inv(chanceToWin > 0.5 ? alpha : 1 - alpha, 0, 1);

  const d = Math.abs((percentImprovement * b) / a);
  console.log({
    chanceToWin,
    percentImprovement,
    a,
    b,
    d,
  });
  return [percentImprovement - d, percentImprovement + d];
}

function getExpectedValue(
  a: number,
  nA: number,
  b: number,
  nB: number
): number {
  const pA = nA > 0 ? a / nA : 0;
  const pB = nB > 0 ? b / nB : 0;
  return pA !== 0 ? (pB - pA) / pA : 0;
}

function binomialABTest(
  aSuccess: number,
  aFailure: number,
  bSuccess: number,
  bFailure: number
) {
  return abTest(
    () => jStat.beta.sample(aSuccess + 1, aFailure + 1),
    () => jStat.beta.sample(bSuccess + 1, bFailure + 1),
    binomialChanceToWin(aSuccess, aFailure, bSuccess, bFailure),
    getExpectedValue(
      aSuccess,
      aSuccess + aFailure,
      bSuccess,
      bSuccess + bFailure
    )
  );
}

function countABTest(
  aCount: number,
  aVisits: number,
  bCount: number,
  bVisits: number
) {
  return abTest(
    () => jStat.gamma.sample(aCount, 1 / aVisits),
    () => jStat.gamma.sample(bCount, 1 / bVisits),
    countChanceToWin(aCount, aVisits, bCount, bVisits),
    getExpectedValue(aCount, aVisits, bCount, bVisits)
  );
}

function bootstrapABTest(
  aStats: MetricStats,
  aVisits: number,
  bStats: MetricStats,
  bVisits: number,
  ignoreNulls: boolean
) {
  const getSampleFunction = (stats: MetricStats, visits: number) => {
    // Standard error (using the Central Limit Theorem)
    const se = stats.stddev / Math.sqrt(stats.count);

    if (ignoreNulls) {
      return () => jStat.normal.sample(stats.mean, se);
    }

    // Standard deviation of the conversion rate
    const crStddev = Math.sqrt(stats.count * (1 - stats.count / visits));

    return () =>
      (jStat.normal.sample(stats.count, crStddev) / visits) *
      jStat.normal.sample(stats.mean, se);
  };

  let expected: number;
  if (ignoreNulls) {
    expected = (bStats.mean - aStats.mean) / aStats.mean;
  } else {
    const aTotalMean = (aStats.mean * aStats.count) / aVisits;
    const bTotalMean = (bStats.mean * bStats.count) / bVisits;
    expected = (bTotalMean - aTotalMean) / aTotalMean;
  }

  return abTest(
    getSampleFunction(aStats, aVisits),
    getSampleFunction(bStats, bVisits),
    null,
    expected
  );
}

function getVariationValue(
  metric: MetricInterface,
  stats: MetricStats,
  users: number
): number {
  if (metric.type === "binomial" || metric.type === "count") {
    return stats.count;
  }
  return stats.mean * users;
}

export async function oldAbTest(
  metric: MetricInterface,
  aUsers: number,
  aStats: MetricStats,
  bUsers: number,
  bStats: MetricStats
): Promise<ABTestStats> {
  if (metric.type === "binomial") {
    return binomialABTest(
      aStats.count,
      aUsers - aStats.count,
      bStats.count,
      bUsers - bStats.count
    );
  } else if (metric.type === "count") {
    return countABTest(aStats.count, aUsers, bStats.count, bUsers);
  } else {
    return bootstrapABTest(aStats, aUsers, bStats, bUsers, metric.ignoreNulls);
  }
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
    ci: [number, number];
    risk: number;
    hdi: {
      dist: string;
      mean?: number;
      stddev?: number;
    };
  } = JSON.parse(result[0]);

  return {
    expected: getExpectedValue(
      getVariationValue(metric, aStats, aUsers),
      aUsers,
      getVariationValue(metric, bStats, bUsers),
      bUsers
    ),
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
