import { createHash } from "node:crypto";

/** A Slack thread is its workspace, channel, and root message `ts`. */
export type SlackThreadIdentity = {
  teamId: string;
  channelId: string;
  rootTs: string;
};

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

/** One conversation per Slack user, GrowthBook account, link generation, organization, and thread. */
export function slackConversationId(
  identity: SlackThreadIdentity & {
    organizationId: string;
    slackUserId: string;
    userId: string;
    linkId: string;
  },
): string {
  return `conv_slack_${slackTaskKey([identity.teamId, identity.channelId, identity.rootTs, identity.organizationId, identity.slackUserId, identity.userId, identity.linkId])}`;
}
