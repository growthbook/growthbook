// eslint-disable-next-line
/// <reference path="../types/jstat.d.ts" />
import { jStat } from "jstat";
import { MetricInterface } from "../../types/metric";
import { MetricStats } from "../types/Integration";

export interface ABTestStats {
  expected: number;
  chanceToWin: number;
  ci: [number, number];
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
  const HISTOGRAM_BUCKETS = 50;

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

  if (chanceToWin === null) {
    chanceToWin = wins / NUM_SAMPLES;
  }

  // CI are the array elements 2.5% and 97.5% from the start
  const ci: [number, number] = [
    change[Math.floor(change.length * 0.025)],
    change[Math.floor(change.length * 0.975)],
  ];

  // Make a histogram of the data (only include 99% of inner values to remove outliers)
  const minValue = change[Math.floor(change.length * 0.005)];
  const maxValue = change[Math.floor(change.length * 0.995)];
  const bucketSize = (maxValue - minValue) / HISTOGRAM_BUCKETS;
  const buckets: { min: number; max: number; count: number }[] = Array(
    HISTOGRAM_BUCKETS
  );
  for (let i = 0; i < HISTOGRAM_BUCKETS; i++) {
    buckets[i] = {
      min: i * bucketSize + minValue,
      max: (i + 1) * bucketSize + minValue,
      count: 0,
    };
  }

  // Fill the histogram with the percent changes
  let currentBucket = 0;
  for (let i = 0; i < change.length; i++) {
    if (change[i] < minValue || change[i] > maxValue) {
      continue;
    }

    while (buckets[currentBucket] && change[i] > buckets[currentBucket].max) {
      currentBucket++;
    }
    if (!buckets[currentBucket]) break;

    buckets[currentBucket].count++;
  }

  return {
    ci,
    expected,
    buckets: buckets.map((bucket) => {
      // Round to 4 decimal places
      const midpoint = parseFloat(((bucket.max + bucket.min) / 2).toFixed(4));
      const value = parseFloat((bucket.count / change.length).toFixed(4));

      return {
        x: midpoint,
        y: value,
      };
    }),
    chanceToWin,
  };
}

function getExpectedValue(
  a: number,
  nA: number,
  b: number,
  nB: number
): number {
  const pA = a / nA;
  const pB = b / nB;
  return (pB - pA) / pA;
}

export function binomialABTest(
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

export function countABTest(
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

export function bootstrapABTest(
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
