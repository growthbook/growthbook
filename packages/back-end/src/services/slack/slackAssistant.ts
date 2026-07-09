import { APP_ORIGIN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { runAgentTurnToCompletion } from "back-end/src/enterprise/services/agent-handler";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import {
  postSlackMessage,
  updateSlackMessage,
} from "back-end/src/services/slack/slackWebApi";
import { toSlackMrkdwn } from "back-end/src/services/slack/slackMarkdown";
import { slackAgentConfig } from "back-end/src/services/slack/slackAgent";
import { buildExperimentCardData } from "back-end/src/services/slack/experimentCardData";
import { renderExperimentCard } from "back-end/src/services/slack/cards";
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
  rootTs: string,
  userId: string,
) {
  const safeTs = rootTs.replace(/[^a-zA-Z0-9]/g, "");
  return `conv_slack_${teamId}_${organizationId}_${safeTs}_${userId}`;
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

  // Resolve the workspace + channel + user to a single org and a
  // permission-scoped context (or a routing/access failure we can surface).
  const target = await resolveSlackAssistantTarget({
    teamId,
    channelId,
    slackUserId,
  });
  if (!target.ok) {
    // Non-mention thread messages stay silent on any failure — don't nag.
    if (mention.requireActiveThread) return;
    if (target.botToken) {
      await postSlackMessage({
        token: target.botToken,
        channel: channelId,
        text: target.message,
        threadTs: rootTs,
      });
    } else {
      // No connection / no token — we can't post anything back.
      logger.warn(`Slack assistant: ${target.reason} for team ${teamId}`);
    }
    return;
  }

  const token = target.botToken;
  const reply = (text: string) =>
    postSlackMessage({ token, channel: channelId, text, threadTs: rootTs });

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
      await finish(result.message);
      return;
    }
    if (result.pendingAction) {
      // The agent wants to make a change — ask for explicit confirmation via
      // buttons rather than applying it silently. The interaction handler
      // replays the parked mutation on Confirm.
      const pa = result.pendingAction;
      const summary = pa.summary || `${pa.method} ${pa.path}`;
      const value = JSON.stringify({ c: conversationId, a: pa.id, t: rootTs });
      const preface = result.reply
        ? `${toSlackMrkdwn(result.reply, { appOrigin: APP_ORIGIN })}\n\n`
        : "";
      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `${preface}I'd like to make this change — confirm?\n\`${summary}\``,
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
            channel: channelId,
            ts: placeholderTs,
            text: "Confirm this change?",
            blocks,
          })
        : false;
      if (!updated) {
        await postSlackMessage({
          token,
          channel: channelId,
          text: "Confirm this change?",
          blocks,
          threadTs: rootTs,
        });
      }
      return;
    }
    await finish(result.reply || "I couldn't find an answer to that.");

    // Attach any experiment results cards the agent asked for, as threaded
    // follow-up image blocks. Best-effort — a render/upload failure never
    // affects the text answer that already landed.
    await attachExperimentCards({
      experimentIds: result.experimentCardIds,
      context: target.context,
      token,
      channel: channelId,
      organizationId: target.organizationId,
      threadTs: rootTs,
    });
  } catch (e) {
    logger.error(e, "Slack assistant turn failed");
    await finish("Something went wrong answering that — please try again.");
  }
}

async function attachExperimentCards({
  experimentIds,
  context,
  token,
  channel,
  organizationId,
  threadTs,
}: {
  experimentIds: string[];
  context: Parameters<typeof buildExperimentCardData>[0];
  token: string;
  channel: string;
  organizationId: string;
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
        organizationId,
        png,
        altText: `${card.name} — experiment results`,
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
      await postSlackMessage({
        token: target.botToken,
        channel: channelId,
        text: target.message,
        threadTs,
      });
    }
    return;
  }
  const token = target.botToken;

  // Only the user who owns this conversation may confirm/cancel it.
  const existing =
    await target.context.models.aiConversations.getById(conversationId);
  if (!existing) {
    await postSlackMessage({
      token,
      channel: channelId,
      text: "This action isn't yours to confirm.",
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
      organizationId: target.organizationId,
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
