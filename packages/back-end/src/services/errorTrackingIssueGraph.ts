export type IssueGraphGranularity =
  | "minute"
  | "fiveMinute"
  | "fifteenMinute"
  | "hour"
  | "day"
  | "week"
  | "month";

export type TrendPoint = { t: number; v: number };

const MIN_BUCKETS = 8;
const MAX_BUCKETS = 96;
const IDEAL_BUCKETS = 32;

const GRANULARITY_ORDER: IssueGraphGranularity[] = [
  "minute",
  "fiveMinute",
  "fifteenMinute",
  "hour",
  "day",
  "week",
  "month",
];

const GRANULARITY_CONFIG: Record<
  IssueGraphGranularity,
  {
    groupExpr: string;
    alignStart: (date: Date) => number;
    nextBucket: (t: number) => number;
  }
> = {
  minute: {
    groupExpr: "toStartOfMinute(timestamp)",
    alignStart: utcStartOfMinute,
    nextBucket: (t) => t + 60_000,
  },
  fiveMinute: {
    groupExpr: "toStartOfFiveMinute(timestamp)",
    alignStart: utcStartOfFiveMinutes,
    nextBucket: (t) => t + 5 * 60_000,
  },
  fifteenMinute: {
    groupExpr: "toStartOfFifteenMinute(timestamp)",
    alignStart: utcStartOfFifteenMinutes,
    nextBucket: (t) => t + 15 * 60_000,
  },
  hour: {
    groupExpr: "toStartOfHour(timestamp)",
    alignStart: utcStartOfHour,
    nextBucket: (t) => t + 3_600_000,
  },
  day: {
    groupExpr: "toStartOfDay(timestamp)",
    alignStart: utcStartOfDay,
    nextBucket: (t) => t + 86_400_000,
  },
  week: {
    groupExpr: "toStartOfWeek(timestamp)",
    alignStart: utcStartOfWeek,
    nextBucket: (t) => t + 7 * 86_400_000,
  },
  month: {
    groupExpr: "toStartOfMonth(timestamp)",
    alignStart: utcStartOfMonth,
    nextBucket: (t) => utcStartOfMonth(new Date(addUtcMonths(t, 1))),
  },
};

export function utcStartOfMinute(date = new Date()): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    0,
    0,
  );
}

export function utcStartOfFiveMinutes(date = new Date()): number {
  const start = utcStartOfMinute(date);
  const minutes = new Date(start).getUTCMinutes();
  return start - (minutes % 5) * 60_000;
}

export function utcStartOfFifteenMinutes(date = new Date()): number {
  const start = utcStartOfMinute(date);
  const minutes = new Date(start).getUTCMinutes();
  return start - (minutes % 15) * 60_000;
}

export function utcStartOfHour(date = new Date()): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    0,
    0,
    0,
  );
}

export function utcStartOfDay(date = new Date()): number {
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    0,
    0,
    0,
    0,
  );
}

export function utcStartOfWeek(date = new Date()): number {
  const dayStart = utcStartOfDay(date);
  const day = new Date(dayStart).getUTCDay();
  const daysFromMonday = (day + 6) % 7;
  return dayStart - daysFromMonday * 86_400_000;
}

export function utcStartOfMonth(date = new Date()): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0);
}

function addUtcMonths(ms: number, months: number): number {
  const date = new Date(ms);
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth() + months,
    1,
    0,
    0,
    0,
    0,
  );
}

export function buildTrendBucketsFromRange(
  firstMs: number,
  lastMs: number,
  granularity: IssueGraphGranularity,
): TrendPoint[] {
  const { alignStart, nextBucket } = GRANULARITY_CONFIG[granularity];
  const start = alignStart(new Date(firstMs));
  const end = alignStart(new Date(Math.max(lastMs, firstMs)));
  const buckets: TrendPoint[] = [];

  for (let t = start; t <= end; t = nextBucket(t)) {
    buckets.push({ t, v: 0 });
  }

  if (!buckets.length) {
    buckets.push({ t: start, v: 0 });
  }

  return buckets;
}

export function chooseAllTimeGranularity(
  firstMs: number,
  lastMs: number,
): IssueGraphGranularity {
  const endMs = Math.max(lastMs, firstMs);

  let best: IssueGraphGranularity = "day";
  let bestScore = Number.POSITIVE_INFINITY;

  for (const granularity of GRANULARITY_ORDER) {
    const bucketCount = buildTrendBucketsFromRange(
      firstMs,
      endMs,
      granularity,
    ).length;

    if (bucketCount > MAX_BUCKETS) {
      continue;
    }

    const score =
      bucketCount < MIN_BUCKETS
        ? 100 + (MIN_BUCKETS - bucketCount)
        : Math.abs(bucketCount - IDEAL_BUCKETS);

    if (score < bestScore) {
      bestScore = score;
      best = granularity;
    }
  }

  return best;
}

export function getAllTimeIssueGraphQuery(
  firstSeen: string,
  lastSeen: string,
): {
  groupExpr: string;
  buckets: TrendPoint[];
} {
  const firstMs = new Date(`${String(firstSeen).replace("Z", "")}Z`).getTime();
  const lastMs = new Date(`${String(lastSeen).replace("Z", "")}Z`).getTime();
  const granularity = chooseAllTimeGranularity(firstMs, lastMs);
  const { groupExpr } = GRANULARITY_CONFIG[granularity];

  return {
    groupExpr,
    buckets: buildTrendBucketsFromRange(firstMs, lastMs, granularity),
  };
}

export function bucketIndexForTimestamp(
  buckets: TrendPoint[],
  timestampMs: number,
): number {
  for (let i = buckets.length - 1; i >= 0; i--) {
    if (timestampMs >= buckets[i].t) {
      return i;
    }
  }
  return -1;
}

export function fillIssueTrendSeries(
  buckets: TrendPoint[],
  rows: TrendPoint[],
): TrendPoint[] {
  const filled = buckets.map((bucket) => ({ ...bucket }));
  for (const row of rows) {
    const idx = bucketIndexForTimestamp(filled, row.t);
    if (idx >= 0) {
      filled[idx].v += row.v;
    }
  }
  return filled;
}
