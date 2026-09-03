import { isTerminalPublishError } from "back-end/src/util/errors";

// Shared policy for how the scheduled-publish poller reacts to a failed publish
// attempt. Kept as pure functions (no I/O, `now` injected) so the decision logic
// is unit-tested directly — the poller wiring only records the outcome.
//
// Both deferred-publish pipelines (generic entity revisions and the legacy
// feature path) use this, so retry/give-up behavior stays identical across them.

// A transient failure retries up to this many attempts before the poller gives
// up (parks the draft + fires `revision.publishFailed`). A terminal failure
// gives up on the first attempt regardless of this cap.
export const SCHEDULED_PUBLISH_MAX_ATTEMPTS = 10;

// Exponential backoff between transient retries, capped. The poller ticks about
// once a minute; without backoff a stuck schedule retries (and error-logs) every
// tick. Backoff spaces out doomed retries while still clearing quickly once the
// blocking condition (merge conflict, sibling lock) resolves.
export const SCHEDULED_PUBLISH_BACKOFF_BASE_MINUTES = 1;
export const SCHEDULED_PUBLISH_BACKOFF_MAX_MINUTES = 30;

export type PublishFailureClassification = "terminal" | "transient";

// Terminal = an explicitly-marked failure that won't self-heal. Everything else
// (merge conflict, sibling publish-lock, unresolved armer context, an unexpected
// DB/network blip) is transient: retried up to the cap. Defaulting the unknown
// case to transient is deliberate — a one-off infrastructure hiccup must not
// permanently park a scheduled publish.
export function classifyPublishFailure(
  error: unknown,
): PublishFailureClassification {
  return isTerminalPublishError(error) ? "terminal" : "transient";
}

// Minutes to wait before the next transient retry, given the attempt count so
// far (1 = the first failure). Exponential, clamped to the max.
export function getScheduledPublishBackoffMinutes(attempts: number): number {
  const safeAttempts = Math.max(1, Math.floor(attempts));
  const minutes =
    SCHEDULED_PUBLISH_BACKOFF_BASE_MINUTES * 2 ** (safeAttempts - 1);
  return Math.min(minutes, SCHEDULED_PUBLISH_BACKOFF_MAX_MINUTES);
}

export type ScheduledPublishOutcome =
  | {
      action: "retry";
      classification: "transient";
      attempts: number;
      backoffMinutes: number;
      nextAttemptAt: Date;
    }
  | {
      action: "give-up";
      classification: PublishFailureClassification;
      attempts: number;
    };

// Decide what to do after a failed scheduled-publish attempt. `attempts` is the
// running failure count INCLUDING the one that just failed; `now` is injected to
// keep this pure. "Give up" signals the poller to park the draft and fire
// `revision.publishFailed`.
export function decideScheduledPublishOutcome({
  error,
  attempts,
  now,
  maxAttempts = SCHEDULED_PUBLISH_MAX_ATTEMPTS,
}: {
  error: unknown;
  attempts: number;
  now: Date;
  maxAttempts?: number;
}): ScheduledPublishOutcome {
  const classification = classifyPublishFailure(error);

  if (classification === "terminal") {
    return { action: "give-up", classification: "terminal", attempts };
  }

  if (attempts >= maxAttempts) {
    return { action: "give-up", classification: "transient", attempts };
  }

  const backoffMinutes = getScheduledPublishBackoffMinutes(attempts);
  return {
    action: "retry",
    classification: "transient",
    attempts,
    backoffMinutes,
    nextAttemptAt: new Date(now.getTime() + backoffMinutes * 60_000),
  };
}
