import { createHmac, timingSafeEqual } from "node:crypto";

const MAX_AGE_SECONDS = 5 * 60;

/**
 * Slack signs `v0:<timestamp>:<raw body>` with the app's signing secret and
 * sends the hex digest as `X-Slack-Signature`. The body must be the exact
 * bytes Slack sent, not a re-serialisation of the parsed JSON.
 */
export function isSlackSignatureValid({
  secret,
  timestamp,
  signature,
  rawBody,
  nowSeconds = Date.now() / 1000,
}: {
  secret: string;
  timestamp: string | undefined;
  signature: string | undefined;
  rawBody: string | undefined;
  nowSeconds?: number;
}): boolean {
  if (!secret || !timestamp || !signature || !rawBody) return false;

  const ageSeconds = Math.abs(nowSeconds - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > MAX_AGE_SECONDS) {
    return false;
  }

  const expected = Buffer.from(
    `v0=${createHmac("sha256", secret)
      .update(`v0:${timestamp}:${rawBody}`)
      .digest("hex")}`,
  );
  const actual = Buffer.from(signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
