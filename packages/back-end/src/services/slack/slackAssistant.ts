import { z } from "zod";
import { stringToBoolean } from "shared/util";
import type { AIAgentPendingAction } from "shared/validators";
import type { ApiReqContext } from "back-end/types/api";
import {
  SlackThreadBusyError,
  SlackThreadIdentity,
  slackTaskKey,
  isCurrentSlackApproval,
  slackConversationId,
} from "back-end/src/services/slack/slackTaskSafety";
import { THREAD_LEASE_RENEW_MS } from "back-end/src/models/SlackTaskClaimModel";
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
// Slack rejects a block text object longer than this.
const SLACK_TEXT_LIMIT = 3000;
const TIMED_OUT_TEXT =
  "This request timed out. Please send a new message to continue.";
const MAX_TURN_MS = 15 * 60 * 1000;

/**
 * Remove the bot mention (and any other leading user mention) from the text.
 * All other whitespace is kept verbatim: quoted values and pasted code depend on it.
 */
function stripBotMention(text: string, botUserId?: string): string {
  let t = text;
  if (botUserId) {
    // Absorb the mention's surrounding spaces so "Ask <@BOT> about" reads "Ask about".
    t = t.replace(
      new RegExp(`[ \\t]*<@${botUserId}(\\|[^>]*)?>[ \\t]*`, "g"),
      " ",
    );
  }
  // Also strip a leading mention of anyone, for when the bot id is unknown.
  t = t.replace(/^\s*<@[^>]+>\s*/, " ");
  return t.trim();
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
 * the queue retries. The lease is renewed while the turn runs. The signal fires
 * at the turn deadline or when the lease is lost, and renewal stops then, so a
 * turn that never returns still lets the lease lapse.
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
  const leases = context.models.slackTaskClaims;
  const key = `thread:${slackTaskKey([thread.teamId, thread.channelId, thread.rootTs])}`;
  const token = await leases.acquireThreadLease(key);
  if (!token) throw new SlackThreadBusyError(placeholderTs);
  const stop = new AbortController();
  const deadline = setTimeout(() => stop.abort(), MAX_TURN_MS);
  const renewal = setInterval(() => {
    if (stop.signal.aborted) return;
    leases.renewThreadLease(key, token).then(
      (held) => {
        if (!held) stop.abort();
      },
      (error) =>
        logger.warn(error, "Slack assistant: could not renew thread lease"),
    );
  }, THREAD_LEASE_RENEW_MS);
  try {
    await turn(stop.signal);
  } finally {
    clearTimeout(deadline);
    clearInterval(renewal);
    // The lease expires on its own; a failed release must not replace the turn's outcome.
    await leases
      .releaseThreadLease(key, token)
      .catch((error) =>
        logger.warn(error, "Slack assistant: could not release thread lease"),
      );
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
  const target = await resolveSlackAssistantTarget({
    requireAssistantEnabled: true,
    teamId,
    slackUserId,
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
      // Ephemerals leave no trace, so log whether Slack accepted this one;
      // otherwise a "nothing happened" report can't be told apart from a
      // missed reply.
      logger[posted ? "info" : "warn"](
        { reason: target.reason, channelId, slackUserId, rootTs, posted },
        posted
          ? "Slack assistant: posted ephemeral prompt to mentioning user"
          : "Slack assistant: FAILED to post ephemeral prompt (see chat.postEphemeral warning above)",
      );
    } else {
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
  const heading = pa.title
    ? `Confirm: ${pa.title.slice(0, 150)}`
    : "Confirm this change?";
  // The agent stores `method path` as the summary when the model wrote none;
  // show it only when there's no title to describe the change instead.
  const fallbackSummary = `${pa.method} ${pa.path.split("?")[0]}`;
  const detail = pa.title && pa.summary === fallbackSummary ? "" : pa.summary;
  // A call that sets ignoreWarnings goes ahead despite GrowthBook's warnings.
  // Say so under the heading (safe from truncation) rather than trusting the
  // model's summary to mention it.
  const ignoresWarnings =
    z.object({ ignoreWarnings: z.literal(true) }).safeParse(pa.body).success ||
    stringToBoolean(pa.query?.ignoreWarnings);
  const lines = [
    `**${heading}**`,
    ...(ignoresWarnings
      ? [
          "⚠️ Confirming proceeds despite GrowthBook's warnings about this change.",
        ]
      : []),
    ...(detail ? [detail] : []),
  ];
  const mrkdwnSection = (markdown: string) => ({
    type: "section",
    text: {
      type: "mrkdwn",
      text: toSlackMrkdwn(markdown, { appOrigin: APP_ORIGIN }).slice(
        0,
        SLACK_TEXT_LIMIT,
      ),
    },
  });
  const value = JSON.stringify({ c: conversationId, a: pa.id, t: threadTs });
  const blocks = [
    mrkdwnSection(lines.join("\n")),
    ...(reply ? [mrkdwnSection(reply.slice(0, 1000))] : []),
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
        text: heading,
        blocks,
      })
    : false;
  if (!updated) {
    await postSlackMessage({
      token,
      channel,
      text: heading,
      blocks,
      threadTs,
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
  if (!threadTs) {
    const token = await getSlackWorkspaceBotToken(teamId);
    if (token)
      await postSlackEphemeralMessage({
        token,
        channel: channelId,
        user: slackUserId,
        text: "This approval is no longer available. Ask me for a new proposal.",
      });
    return;
  }
  const thread = { teamId, channelId, rootTs: threadTs };
  const target = await resolveSlackAssistantTarget({
    requireAssistantEnabled: true,
    teamId,
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
    conversationId !==
    slackConversationId({
      ...thread,
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
  const actionClaim = `action:${slackTaskKey([teamId, target.organizationId, conversationId, actionId])}`;

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
        // The owner clicked a stale card. An unclaimed action was replaced by a
        // newer message, so retire its card; a claimed one was already handled
        // and its card shows the outcome.
        const replaced =
          await target.context.models.slackTaskClaims.claimOnce(actionClaim);
        if (replaced && buttonsMessageTs) {
          await updateSlackMessage({
            token,
            channel: channelId,
            ts: buttonsMessageTs,
            text: "_Replaced by a newer request._",
          });
        }
        await postSlackEphemeralMessage({
          token,
          channel: channelId,
          user: slackUserId,
          text: replaced
            ? "This approval was replaced by a newer request. Use the latest one in this thread."
            : "This approval was already handled.",
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
                actionClaim,
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
