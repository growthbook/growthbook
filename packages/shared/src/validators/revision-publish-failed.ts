import { z } from "zod";

// Extra fields carried by every `*.revision.publishFailed` webhook payload. A
// deferred publish (scheduled publish or auto-publish-on-approval) that the
// poller gives up on fires this event so the failure surfaces to a human
// instead of retrying silently forever. Shared across all revisioned entities
// (feature, saved group, constant, config) so the payloads stay in parity.
export const revisionPublishFailedExtension = {
  // The caught error's message — why the publish could not complete.
  failureReason: z.string(),
  // `terminal` = the failure can't clear on a later tick, so the poller gave up
  // on the first attempt (a stale experiment-guard fingerprint, or no resolvable
  // arming user). Non-terminal failures — merge conflicts, an incomplete
  // pre-launch checklist, or a schema/invariant violation the config's schema or
  // value may yet be edited to satisfy — were retried up to the attempt cap.
  terminal: z.boolean(),
  // How many poller attempts were made before giving up (1 for a terminal
  // failure caught on the first attempt).
  attempts: z.number().int(),
} as const;
