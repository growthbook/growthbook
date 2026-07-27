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
import { buildExperimentCardData } from "back-end/src/services/slack/experimentCardData";
import { renderExperimentCard } from "back-end/src/services/slack/cards";
import { postExperimentCardImage } from "back-end/src/services/slack/cardDelivery";
import { getExperimentViewLink } from "back-end/src/events/handlers/slack/slack-event-handler-utils";

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
      // The agent parked a mutation — confirm via buttons rather than applying
      // it silently. The interaction handler replays it on Confirm.
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
        viewLink: getExperimentViewLink(experimentId),
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

  // Only the user who owns this conversation may confirm/cancel it. The id is
  // `conv_slack_{team}_{org}_{ts}_{userId}` (ts is alphanumeric-only, so the
  // owner is everything after the first "_" past the prefix). getById below
  // enforces the org scope; this enforces the specific owning user, so another
  // linked member of the same org can't act on someone else's parked mutation.
  const ownerPrefix = `conv_slack_${teamId}_${target.organizationId}_`;
  const ownerRest = conversationId.startsWith(ownerPrefix)
    ? conversationId.slice(ownerPrefix.length)
    : "";
  const ownerUserId = ownerRest.includes("_")
    ? ownerRest.slice(ownerRest.indexOf("_") + 1)
    : "";
  if (ownerUserId !== target.userId) {
    await postSlackEphemeralMessage({
      token,
      channel: channelId,
      user: slackUserId,
      text: "This action isn't yours to confirm.",
      threadTs,
    });
    return;
  }

  const existing =
    await target.context.models.aiConversations.getById(conversationId);
  if (!existing) {
    await postSlackEphemeralMessage({
      token,
      channel: channelId,
      user: slackUserId,
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
