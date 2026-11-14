// Wait before each retry of a failed background step, by the number of failed
// attempts so far: quick retries clear a blip within seconds, then the gaps
// grow to a 30-minute ceiling.
const RETRY_BACKOFF_SECONDS = [5, 10, 30, 60, 120, 240, 480, 960, 1800];

export function getRetryBackoffMs(failedAttempts: number): number {
  const index =
    Math.min(
      Math.max(Math.floor(failedAttempts), 1),
      RETRY_BACKOFF_SECONDS.length,
    ) - 1;
  return RETRY_BACKOFF_SECONDS[index] * 1000;
}

// When the next attempt may run, or null once `maxAttempts` have failed.
export function getNextRetryAt(
  failedAttempts: number,
  maxAttempts: number,
  now: Date,
): Date | null {
  if (failedAttempts >= maxAttempts) return null;
  return new Date(now.getTime() + getRetryBackoffMs(failedAttempts));
}
