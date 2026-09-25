import { FeatureUsageLookback } from "shared/types/integrations";

/**
 * Bucket width per lookback, in SECONDS. The single source for the Diagnostics
 * chart's resolution.
 *
 * Seconds rather than minutes because the shortest window needs a sub-minute
 * bucket, and neither consumer can express one in minutes: `Date.setMinutes`
 * truncates a fractional argument to zero, and ClickHouse rejects
 * `INTERVAL 0.5 MINUTE`.
 *
 * This used to be stated three times — the warehouse's toStartOfInterval, the
 * bucket skeleton the rows are placed into, and the front end's dummy-data
 * generator — with nothing tying them together. Two of the three are load
 * bearing and the third is the only one anyone looks at while designing, so a
 * granularity change could land correctly in production and be invisible in
 * `?dummy=true`. It was.
 *
 * One unit for every consumer, so all three read the same number: ClickHouse
 * takes `INTERVAL n SECOND`, and the JavaScript builders take
 * `setSeconds(+n * i)`.
 */
export const FEATURE_USAGE_BUCKET_SECONDS: Record<
  FeatureUsageLookback,
  number
> = {
  // 30 seconds, not 60. This window's job is watching a publish take effect,
  // and SDK propagation happens over tens of seconds — at a minute a bucket
  // that ramp is one or two bars, which is not a shape. Sixteen bars also read
  // as sixteen categories rather than as time.
  "15minute": 30,
  // 1 minute, not 5. At 5 this window drew fewer bars than the 15-minute one
  // above it, so a longer window showed less detail — the progression has to
  // run one way.
  hour: 60,
  // 20 minutes, not an hour. Same reason: 25 bars sat below the hour window's
  // new count. Divides the hour evenly, so the epoch-anchored buckets still
  // land on :00, :20 and :40.
  day: 20 * 60,
  // 2 hours, not 6. At 6 the week drew ~30 bars, which reads as blocks rather
  // than a shape — a whole working day was four bars, so a traffic dip showed
  // as one short block with nothing to describe it.
  week: 2 * 60 * 60,
};

/**
 * A guard on the bucket loops, NOT the bucket count.
 *
 * Resolution comes from the widths above; every window exits its loop on
 * "passed the present" long before reaching this. The longest is the week at
 * ~96 points, so this is headroom — raising it adds no bars to any window.
 *
 * It exists so that a finer width can never silently truncate a window instead
 * of failing visibly: what this cut would simply be missing from the chart,
 * with nothing to say so. It read as a cap when it was 50, which is how it got
 * mistaken for one.
 */
export const FEATURE_USAGE_MAX_DATAPOINTS = 150;

/**
 * Start of the window for a lookback. Shared so the dummy path and the
 * warehouse path agree on where a window begins as well as how finely it is
 * cut — the two together are what decide which buckets exist.
 */
export function getFeatureUsageWindowStart(
  lookback: FeatureUsageLookback,
  now: Date = new Date(),
): Date {
  const start = new Date(now);
  start.setSeconds(0, 0);

  if (lookback === "15minute") {
    start.setMinutes(start.getMinutes() - 15);
  } else if (lookback === "hour") {
    start.setHours(start.getHours() - 1);
    start.setMinutes(0);
  } else if (lookback === "day") {
    start.setHours(start.getHours() - 24);
    start.setMinutes(0);
  } else {
    start.setDate(start.getDate() - 7);
    start.setHours(0);
    start.setMinutes(0);
  }

  return start;
}

/**
 * The bucket timestamps for a window: every consumer's `for` loop, written
 * once. Stops at the present, because a bucket that has not happened yet is not
 * an empty bucket.
 */
export function getFeatureUsageBucketTimes(
  lookback: FeatureUsageLookback,
  /**
   * Pass the start the query actually filtered on. Recomputing it here would be
   * a second answer to a question already settled, and the two only have to
   * disagree by one bucket edge for rows to land nowhere. Omitted — which is
   * right for a caller with no query behind it — it derives the same start the
   * warehouse would have.
   */
  start?: Date | number,
  now: Date = new Date(),
): number[] {
  const from = start ?? getFeatureUsageWindowStart(lookback, now);
  const stepSeconds = FEATURE_USAGE_BUCKET_SECONDS[lookback];
  const times: number[] = [];

  for (let i = 0; i < FEATURE_USAGE_MAX_DATAPOINTS; i++) {
    const ts = new Date(from);
    ts.setSeconds(ts.getSeconds() + stepSeconds * i);
    if (ts > now) break;
    times.push(ts.getTime());
  }

  return times;
}
