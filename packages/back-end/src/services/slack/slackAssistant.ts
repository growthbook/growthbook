import { APP_ORIGIN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { generalAgentConfig } from "back-end/src/agent/general-agent";
import { runAgentTurnToCompletion } from "back-end/src/enterprise/services/agent-handler";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import {
  postSlackMessage,
  updateSlackMessage,
} from "back-end/src/services/slack/slackWebApi";
import { toSlackMrkdwn } from "back-end/src/services/slack/slackMarkdown";

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
    await reply(
      "Ask me about your experiments, features, or metrics — e.g. *what experiments are running right now?*",
    );
    return;
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
      config: generalAgentConfig,
      input: {
        message: question,
        conversationId: conversationIdFor(
          teamId,
          target.organizationId,
          rootTs,
          target.userId,
        ),
      },
    });

    if (!result.ok) {
      await finish(result.message);
      return;
    }
    if (result.pendingAction) {
      // Phase 1 is read-only from Slack — the agent tried to make a change.
      await finish(
        "I can answer questions from Slack, but I can't make changes here yet. Open GrowthBook to apply changes.",
      );
      return;
    }
    await finish(result.reply || "I couldn't find an answer to that.");
  } catch (e) {
    logger.error(e, "Slack assistant turn failed");
    await finish("Something went wrong answering that — please try again.");
  }
}
