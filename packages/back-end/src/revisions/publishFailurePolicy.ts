import { isTerminalPublishError } from "back-end/src/util/errors";
import { getNextRetryAt } from "back-end/src/util/retryBackoff";

// Shared policy for how the scheduled-publish poller reacts to a failed publish
// attempt. Kept as pure functions (no I/O, `now` injected) so the decision logic
// is unit-tested directly — the poller wiring only records the outcome.
//
// Both deferred-publish pipelines (generic entity revisions and the legacy
// feature path) use this, so retry/give-up behavior stays identical across them.

// A transient failure retries up to this many attempts before the poller gives
// up (parks the draft + fires `revision.publishFailed`), about two and a half
// hours after the first failure. A terminal failure gives up on the first
// attempt regardless of this cap.
export const SCHEDULED_PUBLISH_MAX_ATTEMPTS = 13;

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

export type ScheduledPublishOutcome =
  | {
      action: "retry";
      classification: "transient";
      attempts: number;
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

  const nextAttemptAt = getNextRetryAt(attempts, maxAttempts, now);
  if (!nextAttemptAt) {
    return { action: "give-up", classification: "transient", attempts };
  }
  return {
    action: "retry",
    classification: "transient",
    attempts,
    nextAttemptAt,
  };
}
