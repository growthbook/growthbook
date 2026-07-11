import { z } from "zod";

// Extra fields carried by every `*.revision.publishFailed` webhook payload. A
// deferred publish (scheduled publish or auto-publish-on-approval) that the
// poller gives up on fires this event so the failure surfaces to a human
// instead of retrying silently forever. Shared across all revisioned entities
// (feature, saved group, constant, config) so the payloads stay in parity.
export const revisionPublishFailedExtension = {
  // The caught error's message — why the publish could not complete.
  failureReason: z.string(),
  // Terminal failures (pre-launch checklist with no bypass, a stale
  // experiment-guard fingerprint, a hard schema/invariant violation) are given
  // up on immediately. Transient failures (merge conflict, sibling publish lock)
  // were retried up to the attempt cap before giving up.
  terminal: z.boolean(),
  // How many poller attempts were made before giving up (1 for a terminal
  // failure caught on the first attempt).
  attempts: z.number().int(),
} as const;
