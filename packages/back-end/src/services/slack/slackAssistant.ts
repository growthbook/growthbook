import { z } from "zod";
import type {
  AIAgentPendingAction,
  SlackThreadIdentity,
} from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import {
  SlackThreadBusyError,
  slackTaskKey,
  isCurrentSlackApproval,
  slackConversationId,
} from "back-end/src/services/slack/slackTaskSafety";
import { SlackAssistantThreadModel } from "back-end/src/models/SlackAssistantThreadModel";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { runAgentTurnToCompletion } from "back-end/src/enterprise/services/agent-handler";
import {
  resolveSlackAssistantTarget,
  getSlackWorkspaceBotToken,
} from "back-end/src/services/slack/slackIdentity";
import { buildSlackLinkUrl } from "back-end/src/services/slack/slackLink";
import {
  postSlackMessage,
  postSlackEphemeralMessage,
  updateSlackMessage,
  SlackRateLimitError,
} from "back-end/src/services/slack/slackWebApi";
import { toSlackMrkdwn } from "back-end/src/util/slack.util";
import { slackAgentConfig } from "back-end/src/services/slack/slackAgent";

export const slackAssistantMentionSchema = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  slackUserId: z.string().min(1),
  text: z.string(),
  messageTs: z.string().min(1),
  threadTs: z.string().optional(),
  botUserId: z.string().optional(),
  /** Slack `ts` of the "Thinking…" message the first attempt posted; a busy retry edits it instead of posting another. */
  placeholderTs: z.string().optional(),
});
export type SlackAssistantMention = z.infer<typeof slackAssistantMentionSchema>;

export const slackAssistantConfirmationSchema = z.object({
  teamId: z.string().min(1),
  channelId: z.string().min(1),
  slackUserId: z.string().min(1),
  conversationId: z.string().min(1),
  actionId: z.string().min(1),
  decision: z.enum(["confirm", "cancel"]),
  threadTs: z.string().optional(),
  buttonsMessageTs: z.string().optional(),
  /** Slack action timestamp identifies a click; retries of that delivery reuse it. */
  interactionTs: z.string().min(1),
});
export type SlackAssistantConfirmation = z.infer<
  typeof slackAssistantConfirmationSchema
>;

const THINKING_TEXT = "_Thinking…_";
const TIMED_OUT_TEXT =
  "This request timed out. Please send a new message to continue.";
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

function postSlackAccountLink({
  mention,
  token,
  text,
}: {
  mention: SlackAssistantMention;
  token: string;
  text: string;
}): Promise<boolean> {
  const url = buildSlackLinkUrl({
    slackTeamId: mention.teamId,
    slackUserId: mention.slackUserId,
  });
  return postSlackEphemeralMessage({
    token,
    channel: mention.channelId,
    user: mention.slackUserId,
    threadTs: mention.threadTs,
    text: `${text} <${url}|Link my account>. After linking, send your question again.`,
  });
}

/**
 * Runs one turn while holding the thread's lease, so turns in a Slack thread
 * never overlap. Throws SlackThreadBusyError while another worker holds it and
 * the queue retries. The signal fires at the lease's deadline, after which a
 * crashed or hung worker's lease may be taken over.
 */
async function withThreadTurn({
  context,
  thread,
  placeholderTs,
  turn,
}: {
  context: ApiReqContext;
  thread: SlackThreadIdentity;
  placeholderTs?: string;
  turn: (signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const key = `thread:${slackTaskKey([thread.teamId, thread.channelId, thread.rootTs])}`;
  const lease = await context.models.slackTaskClaims.acquireThreadLease(key);
  if (!lease) throw new SlackThreadBusyError(placeholderTs);
  try {
    await turn(
      AbortSignal.timeout(Math.max(0, lease.expiresAt.getTime() - Date.now())),
    );
  } finally {
    await context.models.slackTaskClaims.releaseThreadLease(key, lease.token);
  }
}

/**
 * Answer a Slack @mention by running the general AI assistant as the matched
 * GrowthBook user and posting the reply back in-thread. Designed to be called
 * after the Events endpoint has already ACKed Slack (it can take many seconds).
 *
 * Delivery rate-limit exhaustion propagates so the queue records a failure.
 */
export async function handleSlackAssistantMention(
  mention: SlackAssistantMention,
): Promise<void> {
  const { teamId, channelId, slackUserId, messageTs } = mention;
  const rootTs = mention.threadTs || messageTs;

  logger.info(
    { teamId, channelId, slackUserId, threaded: !!mention.threadTs },
    "Slack assistant: handling mention",
  );

  const question = stripBotMention(mention.text, mention.botUserId);
  if (question.toLowerCase() === "link account") {
    const token = await getSlackWorkspaceBotToken(teamId);
    if (token)
      await postSlackAccountLink({
        mention,
        token,
        text: "Link or replace your GrowthBook account.",
      });
    return;
  }
  const threadIdentity = { teamId, channelId, rootTs };
  const thread =
    await SlackAssistantThreadModel.dangerousGetForThread(threadIdentity);
  const target = await resolveSlackAssistantTarget({
    requireAssistantEnabled: true,
    teamId,
    slackUserId,
    organizationId: thread?.organization,
  });
  if (!target.ok) {
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
      const posted =
        target.reason === "not_linked"
          ? await postSlackAccountLink({
              mention,
              token: target.botToken,
              text: target.message,
            })
          : await postSlackEphemeralMessage({
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

  if (!question) {
    await reply(
      "Ask me about your experiments, features, or metrics — e.g. *what experiments are running right now?*",
    );
    return;
  }

  const bound =
    await target.context.models.slackAssistantThreads.bindConversationThread(
      threadIdentity,
    );
  if (bound.organization !== target.organizationId) {
    throw new Error(
      "The Slack thread organization changed. Please send your question again.",
    );
  }
  const conversationId = slackConversationId({
    ...threadIdentity,
    organizationId: target.organizationId,
    slackUserId,
    userId: target.userId,
    linkId: target.linkId,
  });

  // Post a placeholder immediately, then swap it for the answer in place. A
  // busy retry reuses the one its first attempt posted.
  const placeholderTs =
    mention.placeholderTs ??
    (await postSlackMessage({
      token,
      channel: channelId,
      text: THINKING_TEXT,
      threadTs: rootTs,
    }));

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

  await withThreadTurn({
    context: target.context,
    thread: threadIdentity,
    placeholderTs: placeholderTs ?? undefined,
    turn: async (signal) => {
      try {
        const result = await runAgentTurnToCompletion({
          context: target.context,
          config: slackAgentConfig,
          signal,
          input: { message: question, conversationId },
        });

        if (signal.aborted) {
          await finish(TIMED_OUT_TEXT);
          return;
        }
        if (!result.ok) {
          await finish(result.message);
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
      } catch (e) {
        if (e instanceof SlackRateLimitError) throw e;
        logger.error(e, "Slack assistant turn failed");
        await finish("Something went wrong answering that — please try again.");
      }
    },
  });
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

/**
 * Handle a Confirm/Cancel button click on a parked mutation. Verifies the
 * clicking user owns the conversation, then replays the turn with the decision
 * (Confirm dispatches the real API call; Cancel records a rejection) and posts
 * the outcome in-thread. Called after the interactions endpoint ACKs Slack.
 */
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
  const thread = threadTs
    ? await SlackAssistantThreadModel.dangerousGetForThread({
        teamId,
        channelId,
        rootTs: threadTs,
      })
    : null;
  if (!thread) {
    const token = await getSlackWorkspaceBotToken(teamId);
    if (token)
      await postSlackEphemeralMessage({
        token,
        channel: channelId,
        user: slackUserId,
        threadTs,
        text: "This approval is no longer available. Ask me for a new proposal.",
      });
    return;
  }
  const target = await resolveSlackAssistantTarget({
    requireAssistantEnabled: true,
    teamId,
    slackUserId,
    organizationId: thread.organization,
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
      slackConversationId({
        teamId,
        channelId,
        rootTs: threadTs,
        organizationId: target.organizationId,
        slackUserId,
        userId: target.userId,
        linkId: target.linkId,
      })
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

  await withThreadTurn({
    context: target.context,
    thread,
    turn: async (signal) => {
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

      let alreadySubmitted = false;
      try {
        const result = await runAgentTurnToCompletion({
          context: target.context,
          config: slackAgentConfig,
          signal,
          beforeResolvePendingAction: async () => {
            const current = await resolveSlackAssistantTarget({
              requireAssistantEnabled: true,
              teamId,
              slackUserId,
              organizationId: thread.organization,
            });
            if (
              !current.ok ||
              current.linkId !== target.linkId ||
              current.userId !== target.userId ||
              current.context.getPermissionsFingerprint() !==
                target.context.getPermissionsFingerprint()
            ) {
              throw new Error(
                "Your Slack account link or GrowthBook access changed. Please request a new proposal.",
              );
            }
            // A preflight failure leaves the action and its buttons available. Once
            // dispatch can begin, retain this claim even if its outcome is uncertain.
            if (
              !(await current.context.models.slackTaskClaims.claimOnce(
                `action:${slackTaskKey([teamId, target.organizationId, conversationId, actionId])}`,
              ))
            ) {
              alreadySubmitted = true;
              throw new Error("Slack action already submitted");
            }
            if (buttonsMessageTs) {
              try {
                await updateSlackMessage({
                  token,
                  channel: channelId,
                  ts: buttonsMessageTs,
                  text:
                    decision === "confirm"
                      ? "_Applying change…_"
                      : "_Change cancelled._",
                });
              } catch (error) {
                // A Slack UI failure must not strand an already claimed mutation.
                logger.warn(error, "Could not update Slack approval controls");
              }
            }
          },
          input: {
            message: "",
            conversationId,
            confirmActionId: actionId,
            confirmDecision: decision,
          },
        });
        if (signal.aborted) {
          await postSlackMessage({
            token,
            channel: channelId,
            text: "This request timed out. Check GrowthBook before repeating an approved change.",
            threadTs,
          });
          return;
        }
        if (!result.ok) {
          await postSlackMessage({
            token,
            channel: channelId,
            text: toSlackMrkdwn(result.message, { appOrigin: APP_ORIGIN }),
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
            result.reply ||
              (decision === "confirm" ? "Done." : "Okay, cancelled."),
            { appOrigin: APP_ORIGIN },
          ),
          threadTs,
        });
      } catch (e) {
        if (e instanceof SlackRateLimitError) throw e;
        logger.error(e, "Slack assistant confirmation failed");
        await postSlackMessage({
          token,
          channel: channelId,
          text: alreadySubmitted
            ? "This action has already been submitted. Check GrowthBook before requesting it again."
            : "Something went wrong applying that change.",
          threadTs,
        });
      }
    },
  });
}
