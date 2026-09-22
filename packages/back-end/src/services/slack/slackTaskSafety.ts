import { createHash } from "node:crypto";

export function slackTaskKey(parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Another worker holds this Slack thread; the queue retries shortly. */
export class SlackThreadBusyError extends Error {
  /** Placeholder the first attempt posted, so the retry does not post another. */
  readonly placeholderTs?: string;
  constructor(placeholderTs?: string) {
    super("Another request in this Slack thread is still running.");
    this.placeholderTs = placeholderTs;
  }
}

export function isCurrentSlackApproval(
  pendingActionId: string | undefined,
  actionId: string,
): boolean {
  return !!pendingActionId && pendingActionId === actionId;
}
