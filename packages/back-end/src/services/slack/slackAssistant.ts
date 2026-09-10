import type { AIAgentPendingAction } from "shared/validators";
import {
  claimSlackTask,
  slackTaskKey,
  isCurrentSlackApproval,
} from "back-end/src/services/slack/slackTaskSafety";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { runAgentTurnToCompletion } from "back-end/src/enterprise/services/agent-handler";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import {
  postSlackMessage,
  postSlackEphemeralMessage,
  updateSlackMessage,
} from "back-end/src/services/slack/slackWebApi";
import { toSlackMrkdwn } from "back-end/src/services/slack/slackMarkdown";
import { slackAgentConfig } from "back-end/src/services/slack/slackAgent";
import { buildExperimentCardData } from "back-end/src/services/notificationCards/experimentCardData";
import { renderExperimentCard } from "back-end/src/services/notificationCards/experimentCards";
import { postExperimentCardImage } from "back-end/src/services/slack/cardDelivery";

export interface SlackAssistantMention {
  teamId: string;
  channelId: string;
  /** Slack id of the user who mentioned the bot. */
  slackUserId: string;
  /** Raw message text (still contains the <@bot> mention). */
  text: string;
  /** ts of the message that mentioned the bot. */
  messageTs: string;
  /** thread_ts when the mention was already inside a thread. */
  threadTs?: string;
  /** The bot's own user id, used to strip the leading mention from `text`. */
  botUserId?: string;
  /**
   * When true (a non-mention thread message), only respond if this user already
   * has an assistant conversation in this thread — and stay silent otherwise
   * (no "link your account" / help nags). @mentions leave this false.
   */
  requireActiveThread?: boolean;
}

const THINKING_TEXT = "_Thinking…_";

/** Remove the bot mention (and any other leading user mention) from the text. */
function stripBotMention(text: string, botUserId?: string): string {
  let t = text;
  if (botUserId) {
    t = t.replace(new RegExp(`<@${botUserId}(\\|[^>]*)?>`, "g"), " ");
  }
  // Strip a leading mention of anyone, just in case the bot id wasn't passed.
  t = t.replace(/^\s*<@[^>]+>\s*/, " ");
  return t.replace(/\s+/g, " ").trim();
}

/** Stable per-(thread, user, org) conversation id so a thread keeps its context. */
function conversationIdFor(
  teamId: string,
  organizationId: string,
  channelId: string,
  rootTs: string,
  userId: string,
) {
  const safeTs = rootTs.replace(/[^a-zA-Z0-9]/g, "");
  return `conv_slack_${teamId}_${organizationId}_${channelId}_${safeTs}_${userId}`;
}

/**
 * Answer a Slack @mention by running the general AI assistant as the matched
 * GrowthBook user and posting the reply back in-thread. Designed to be called
 * after the Events endpoint has already ACKed Slack (it can take many seconds).
 *
 * Never throws — every failure path posts a user-facing message instead.
 */
export async function handleSlackAssistantMention(
  mention: SlackAssistantMention,
): Promise<void> {
  const { teamId, channelId, slackUserId, messageTs } = mention;
  const rootTs = mention.threadTs || messageTs;

  logger.info(
    {
      teamId,
      channelId,
      slackUserId,
      threaded: !!mention.threadTs,
      requireActiveThread: !!mention.requireActiveThread,
    },
    "Slack assistant: handling mention",
  );

  // Resolve the workspace + channel + user to a single org and a
  // permission-scoped context (or a routing/access failure we can surface).
  const target = await resolveSlackAssistantTarget({
    teamId,
    channelId,
    slackUserId,
  });
  if (!target.ok) {
    // Non-mention thread messages stay silent on any failure — don't nag.
    if (mention.requireActiveThread) {
      logger.info(
        { reason: target.reason, teamId, channelId, slackUserId },
        "Slack assistant: unresolved thread-follow, staying silent",
      );
      return;
    }
    if (target.botToken) {
      // Ephemeral (visible only to the mentioning user): these messages are
      // directed at them, and the "not linked" one carries a signed account-
      // link URL that must not be exposed to everyone in the channel.
      //
      // Only thread it when the mention itself came from inside a thread. A
      // threaded ephemeral on a top-level mention is effectively invisible —
      // ephemerals create no "N replies" indicator, so it hides in a thread
      // that looks empty from the channel. Posting inline shows it where the
      // user is looking.
      const posted = await postSlackEphemeralMessage({
        token: target.botToken,
        channel: channelId,
        user: slackUserId,
        text: target.message,
        threadTs: mention.threadTs,
      });
      // Ephemeral messages are visible only to the mentioning user and are
      // transient, so log whether Slack accepted the post — otherwise a
      // "nothing happened" report is impossible to distinguish from a missed
      // ephemeral reply.
      logger[posted ? "info" : "warn"](
        { reason: target.reason, channelId, slackUserId, rootTs, posted },
        posted
          ? "Slack assistant: posted ephemeral prompt to mentioning user"
          : "Slack assistant: FAILED to post ephemeral prompt (see chat.postEphemeral warning above)",
      );
    } else {
      // No connection / no token — we can't post anything back.
      logger.warn(
        { reason: target.reason, teamId, channelId, slackUserId },
        "Slack assistant: cannot reply (no bot token for this workspace)",
      );
    }
    return;
  }

  logger.info(
    {
      organizationId: target.organizationId,
      growthbookUserId: target.userId,
      channelId,
    },
    "Slack assistant: resolved linked user, running agent turn",
  );

  const token = target.botToken;
  const reply = (text: string) =>
    postSlackMessage({ token, channel: channelId, text, threadTs: rootTs });

  // The workspace has turned the conversational assistant off. Reply once with
  // a visible (non-secret) message so people understand why the bot isn't
  // answering, then stop before running a turn. Notifications are unaffected.
  // Stay silent on ambient thread-follows so we don't repeat it on every reply.
  if (!target.assistantEnabled) {
    logger.info(
      { organizationId: target.organizationId, channelId },
      "Slack assistant: conversation disabled for workspace, not answering",
    );
    if (!mention.requireActiveThread) {
      await reply(
        "The GrowthBook assistant is turned off for this workspace, so I can't answer questions right now — but I'm still posting notifications here. An admin can turn it back on in *GrowthBook → Integrations → Slack*.",
      );
    }
    return;
  }

  const question = stripBotMention(mention.text, mention.botUserId);
  if (!question) {
    if (mention.requireActiveThread) return;
    await reply(
      "Ask me about your experiments, features, or metrics — e.g. *what experiments are running right now?*",
    );
    return;
  }

  const conversationId = conversationIdFor(
    teamId,
    target.organizationId,
    channelId,
    rootTs,
    target.userId,
  );

  // Thread-follow: only respond to a non-mention message if this user already
  // has an assistant conversation in this thread. Otherwise stay silent — we
  // don't start conversations from ambient thread chatter.
  if (mention.requireActiveThread) {
    const existing =
      await target.context.models.aiConversations.getById(conversationId);
    if (!existing) return;
  }

  // Post a placeholder immediately, then swap it for the answer in place.
  const placeholderTs = await postSlackMessage({
    token,
    channel: channelId,
    text: THINKING_TEXT,
    threadTs: rootTs,
  });

  const finish = async (text: string) => {
    const mrkdwn = toSlackMrkdwn(text, { appOrigin: APP_ORIGIN });
    if (placeholderTs) {
      const ok = await updateSlackMessage({
        token,
        channel: channelId,
        ts: placeholderTs,
        text: mrkdwn,
      });
      if (ok) return;
    }
    await postSlackMessage({
      token,
      channel: channelId,
      text: mrkdwn,
      threadTs: rootTs,
    });
  };

  try {
    const result = await runAgentTurnToCompletion({
      context: target.context,
      config: slackAgentConfig,
      input: { message: question, conversationId },
    });

    if (!result.ok) {
      // A blocked access gate (no AI plan → 403, AI not enabled → 404) returns
      // a terse internal string; give Slack users a clear, actionable message
      // instead. Other failures (e.g. rate limit) keep their specific message.
      const friendly =
        result.status === 403 || result.status === 404
          ? "The GrowthBook AI assistant isn't enabled for your organization, so I can't answer questions — but notifications will still post here. An admin can enable AI in *GrowthBook → Settings → General* (AI features)."
          : result.message;
      await finish(friendly);
      return;
    }
    if (result.pendingAction) {
      await postPendingApproval({
        pa: result.pendingAction,
        reply: result.reply,
        conversationId,
        token,
        channel: channelId,
        threadTs: rootTs,
        placeholderTs,
      });
      return;
    }
    await finish(result.reply || "I couldn't find an answer to that.");

    // Attach any experiment cards the agent asked for as threaded image blocks.
    // Best-effort — a render/upload failure never affects the text answer.
    await attachExperimentCards({
      experimentIds: result.experimentCardIds,
      context: target.context,
      token,
      channel: channelId,
      threadTs: rootTs,
    });
  } catch (e) {
    logger.error(e, "Slack assistant turn failed");
    await finish("Something went wrong answering that — please try again.");
  }
}

async function postPendingApproval({
  pa,
  reply,
  conversationId,
  token,
  channel,
  threadTs,
  placeholderTs,
}: {
  pa: AIAgentPendingAction;
  reply: string;
  conversationId: string;
  token: string;
  channel: string;
  threadTs?: string;
  placeholderTs?: string | null;
}): Promise<void> {
  const summary = pa.summary || `${pa.method} ${pa.path}`;
  const value = JSON.stringify({ c: conversationId, a: pa.id, t: threadTs });
  const blocks = [
    {
      type: "section",
      text: {
        type: "plain_text",
        text: `Confirm this change?\n${summary.slice(0, 1800)}${reply ? `\n\n${reply.slice(0, 1000)}` : ""}`,
      },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: "gb_confirm_action",
          style: "primary",
          text: { type: "plain_text", text: "Confirm" },
          value,
        },
        {
          type: "button",
          action_id: "gb_cancel_action",
          text: { type: "plain_text", text: "Cancel" },
          value,
        },
      ],
    },
  ];
  const updated = placeholderTs
    ? await updateSlackMessage({
        token,
        channel,
        ts: placeholderTs,
        text: "Confirm this change?",
        blocks,
      })
    : false;
  if (!updated) {
    await postSlackMessage({
      token,
      channel,
      text: "Confirm this change?",
      blocks,
      threadTs: threadTs,
    });
  }
}

async function attachExperimentCards({
  experimentIds,
  context,
  token,
  channel,
  threadTs,
}: {
  experimentIds: string[];
  context: Parameters<typeof buildExperimentCardData>[0];
  token: string;
  channel: string;
  threadTs: string;
}): Promise<void> {
  for (const experimentId of experimentIds) {
    try {
      const card = await buildExperimentCardData(context, experimentId);
      if (!card) continue;
      const png = await renderExperimentCard(card);
      await postExperimentCardImage({
        token,
        channel,
        png,
        altText: `${card.name} — experiment results`,
        viewLink: `<${APP_ORIGIN}/experiment/${experimentId}|View experiment>`,
        threadTs,
      });
    } catch (e) {
      logger.error(
        e,
        `Slack assistant: failed to attach card for ${experimentId}`,
      );
    }
  }
}

/**
 * Handle a Confirm/Cancel button click on a parked mutation. Verifies the
 * clicking user owns the conversation, then replays the turn with the decision
 * (Confirm dispatches the real API call; Cancel records a rejection) and posts
 * the outcome in-thread. Called after the interactions endpoint ACKs Slack.
 */
export interface SlackAssistantConfirmation {
  teamId: string;
  channelId: string;
  slackUserId: string;
  conversationId: string;
  actionId: string;
  decision: "confirm" | "cancel";
  threadTs?: string;
  buttonsMessageTs?: string;
}

export async function handleSlackAssistantConfirmation({
  teamId,
  channelId,
  slackUserId,
  conversationId,
  actionId,
  decision,
  threadTs,
  buttonsMessageTs,
}: SlackAssistantConfirmation): Promise<void> {
  const target = await resolveSlackAssistantTarget({
    teamId,
    channelId,
    slackUserId,
  });
  if (!target.ok) {
    if (target.botToken) {
      await postSlackEphemeralMessage({
        token: target.botToken,
        channel: channelId,
        user: slackUserId,
        text: target.message,
        threadTs,
      });
    }
    return;
  }
  const token = target.botToken;

  // Bind approval to its original channel, thread, organization, and owner.
  if (
    !threadTs ||
    conversationId !==
      conversationIdFor(
        teamId,
        target.organizationId,
        channelId,
        threadTs,
        target.userId,
      )
  ) {
    await postSlackEphemeralMessage({
      token,
      channel: channelId,
      user: slackUserId,
      text: "This action isn't yours to confirm.",
      threadTs,
    });
    return;
  }

  if (!target.assistantEnabled) {
    await postSlackEphemeralMessage({
      token,
      channel: channelId,
      user: slackUserId,
      text: "The GrowthBook assistant is turned off for this workspace.",
      threadTs,
    });
    return;
  }

  const existing =
    await target.context.models.aiConversations.getById(conversationId);
  if (
    !existing ||
    !isCurrentSlackApproval(existing.pendingAction?.id, actionId)
  ) {
    await postSlackEphemeralMessage({
      token,
      channel: channelId,
      user: slackUserId,
      text: "This action isn't yours to confirm.",
      threadTs,
    });
    return;
  }

  // A crash after applying a mutation must never turn a retry into another write.
  if (
    !(await claimSlackTask(
      `action:${slackTaskKey([teamId, target.organizationId, conversationId, actionId])}`,
    ))
  ) {
    await postSlackEphemeralMessage({
      token,
      channel: channelId,
      user: slackUserId,
      text: "This action has already been submitted. Check GrowthBook before requesting it again.",
      threadTs,
    });
    return;
  }

  // Swap the buttons for a status line so it can't be double-clicked.
  if (buttonsMessageTs) {
    await updateSlackMessage({
      token,
      channel: channelId,
      ts: buttonsMessageTs,
      text:
        decision === "confirm" ? "_Applying change…_" : "_Change cancelled._",
    });
  }

  try {
    const result = await runAgentTurnToCompletion({
      context: target.context,
      config: slackAgentConfig,
      input: {
        message: "",
        conversationId,
        confirmActionId: actionId,
        confirmDecision: decision,
      },
    });
    if (!result.ok) {
      await postSlackMessage({
        token,
        channel: channelId,
        text: result.message,
        threadTs,
      });
      return;
    }
    if (result.pendingAction) {
      await postPendingApproval({
        pa: result.pendingAction,
        reply: result.reply,
        conversationId,
        token,
        channel: channelId,
        threadTs,
      });
      return;
    }
    await postSlackMessage({
      token,
      channel: channelId,
      text: toSlackMrkdwn(
        result.reply || (decision === "confirm" ? "Done." : "Okay, cancelled."),
        { appOrigin: APP_ORIGIN },
      ),
      threadTs,
    });
    await attachExperimentCards({
      experimentIds: result.experimentCardIds,
      context: target.context,
      token,
      channel: channelId,
      threadTs: threadTs || "",
    });
  } catch (e) {
    logger.error(e, "Slack assistant confirmation failed");
    await postSlackMessage({
      token,
      channel: channelId,
      text: "Something went wrong applying that change.",
      threadTs,
    });
  }
}
