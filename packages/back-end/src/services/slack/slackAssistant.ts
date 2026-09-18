import type { AIAgentPendingAction } from "shared/validators";
import {
  claimSlackTask,
  slackTaskKey,
  isCurrentSlackApproval,
} from "back-end/src/services/slack/slackTaskSafety";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { runAgentTurnToCompletion } from "back-end/src/enterprise/services/agent-handler";
import { getExperimentById } from "back-end/src/models/ExperimentModel";
import { getFeature } from "back-end/src/models/FeatureModel";
import {
  resolveSlackAssistantTarget,
  getSlackWorkspaceBotToken,
} from "back-end/src/services/slack/slackIdentity";
import type {
  AmbiguousSlackTarget,
  ResolvedSlackTarget,
} from "back-end/src/services/slack/slackIdentity";
import { buildSlackLinkUrl } from "back-end/src/services/slack/slackLink";
import {
  inferSlackOrganizationByName,
  parseSlackResourceReferences,
} from "back-end/src/services/slack/slackOrganizationInference";
import type { SlackResourceRef } from "back-end/src/services/slack/slackOrganizationInference";
import {
  SlackAssistantMention,
  SlackOrganizationSelection,
  getSlackThread,
  isSlackDirectMessageChannel,
  pinSlackThreadOrganization,
  saveSlackOrganizationPicker,
  consumeSlackOrganizationSelection,
  slackConversationId,
  slackOrganizationPickerBlocks,
} from "back-end/src/services/slack/slackThreadRouting";
export type {
  SlackAssistantMention,
  SlackOrganizationSelection,
} from "back-end/src/services/slack/slackThreadRouting";
import {
  clearSlackDefaultOrganization,
  getSlackUserPreference,
  setSlackDefaultOrganization,
} from "back-end/src/services/slack/slackUserPreference";
import {
  postSlackMessage,
  postSlackEphemeralMessage,
  updateSlackMessage,
} from "back-end/src/services/slack/slackWebApi";
import {
  escapeSlackText,
  toSlackMrkdwn,
} from "back-end/src/services/slack/slackMarkdown";
import { slackAgentConfig } from "back-end/src/services/slack/slackAgent";

const THINKING_TEXT = "_Thinking…_";
const SWITCH_ORGANIZATION_TEXT = /^switch organi[sz]ation$/i;
const REMEMBER_ORGANIZATION_TEXT = /^remember organi[sz]ation$/i;

function organizationLabel(target: ResolvedSlackTarget): string {
  return target.linkedOrganizationCount > 1
    ? `\n\n_Answering as ${escapeSlackText(target.organizationName)}_`
    : "";
}

async function organizationsOwningReferences(
  refs: SlackResourceRef[],
  targets: ResolvedSlackTarget[],
): Promise<string[]> {
  const owners: string[] = [];
  for (const target of targets) {
    for (const ref of refs) {
      const resource =
        ref.kind === "experiment"
          ? await getExperimentById(target.context, ref.id)
          : await getFeature(target.context, ref.id);
      if (resource) {
        owners.push(target.organizationId);
        break;
      }
    }
    // Two owners already make the reference ambiguous, and no later one can
    // undo that, so stop reading other organizations' resources.
    if (owners.length > 1) break;
  }
  return owners;
}

// Order for a new thread with several eligible orgs: the owner of a linked
// resource, then an org named in the text, then (DMs only) the stored default.
async function inferSlackOrganization(
  question: string,
  ambiguous: AmbiguousSlackTarget,
  identity: { teamId: string; channelId: string; slackUserId: string },
): Promise<string | null> {
  const refs = parseSlackResourceReferences(question, APP_ORIGIN);
  if (refs.length) {
    const owners = await organizationsOwningReferences(refs, ambiguous.targets);
    if (owners.length === 1) return owners[0];
  }
  const named = inferSlackOrganizationByName(question, ambiguous.choices);
  if (named) return named.organizationId;
  if (!isSlackDirectMessageChannel(identity.channelId)) return null;
  const preference = await getSlackUserPreference({
    slackTeamId: identity.teamId,
    slackUserId: identity.slackUserId,
  });
  if (!preference) return null;
  return ambiguous.choices.some(
    (c) => c.organizationId === preference.defaultOrganizationId,
  )
    ? preference.defaultOrganizationId
    : null;
}

async function replyPrivately(
  mention: SlackAssistantMention,
  text: string,
): Promise<void> {
  const token = await getSlackWorkspaceBotToken(mention.teamId);
  if (!token) return;
  await postSlackEphemeralMessage({
    token,
    channel: mention.channelId,
    user: mention.slackUserId,
    threadTs: mention.threadTs,
    text,
  });
}

async function rememberThreadOrganization(
  mention: SlackAssistantMention,
  rootTs: string,
): Promise<void> {
  const { teamId, channelId, slackUserId } = mention;
  try {
    const thread = await getSlackThread({ teamId, channelId, rootTs });
    if (thread?.status !== "selected") {
      await replyPrivately(
        mention,
        'Ask me a question first, then send "remember organization" in that thread and I\'ll use its organization for your future direct messages.',
      );
      return;
    }
    // The pin is trusted routing state, not proof of access: a notification can
    // pin a thread and a link can be revoked after a pin was written.
    const target = await resolveSlackAssistantTarget({
      requireAssistantEnabled: true,
      teamId,
      channelId,
      slackUserId,
      organizationId: thread.organizationId,
    });
    if (!target.ok) {
      await replyPrivately(mention, target.message);
      return;
    }
    await setSlackDefaultOrganization(
      { slackTeamId: teamId, slackUserId },
      target.organizationId,
    );
    await replyPrivately(
      mention,
      `I'll use ${escapeSlackText(target.organizationName)} for your future direct messages. Send "switch organization" to clear it.`,
    );
  } catch (error) {
    logger.error(error, "Could not store a Slack default organization");
    await replyPrivately(
      mention,
      "I couldn't save that default. Please send the message again.",
    );
  }
}

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

  const question = stripBotMention(mention.text, mention.botUserId);
  if (
    !mention.requireActiveThread &&
    question.toLowerCase() === "link account"
  ) {
    const token = await getSlackWorkspaceBotToken(teamId);
    if (token)
      await postSlackEphemeralMessage({
        token,
        channel: channelId,
        user: slackUserId,
        threadTs: mention.threadTs,
        text:
          "Link or replace your account for a GrowthBook organization: " +
          buildSlackLinkUrl({ slackTeamId: teamId, slackUserId }),
      });
    return;
  }
  if (!mention.requireActiveThread && isSlackDirectMessageChannel(channelId)) {
    if (SWITCH_ORGANIZATION_TEXT.test(question)) {
      await clearSlackDefaultOrganization({ slackTeamId: teamId, slackUserId });
      await replyPrivately(
        mention,
        "Your default organization for direct messages is cleared. Your next new message will ask which organization to use.",
      );
      return;
    }
    if (REMEMBER_ORGANIZATION_TEXT.test(question)) {
      await rememberThreadOrganization(mention, rootTs);
      return;
    }
  }
  const threadIdentity = { teamId, channelId, rootTs };
  const thread = await getSlackThread(threadIdentity);
  if (mention.requireActiveThread && thread?.status !== "selected") return;
  let target = await resolveSlackAssistantTarget({
    requireAssistantEnabled: true,
    teamId,
    channelId,
    slackUserId,
    organizationId:
      thread?.status === "selected" ? thread.organizationId : undefined,
  });
  if (
    !target.ok &&
    target.reason === "ambiguous_org" &&
    !mention.requireActiveThread
  ) {
    // Inference is a convenience over the picker. Anything it reads may fail,
    // and the picker is always a correct answer, so never fail the turn for it.
    let inferred: string | null = null;
    try {
      inferred = await inferSlackOrganization(question, target, {
        teamId,
        channelId,
        slackUserId,
      });
    } catch (error) {
      logger.error(error, "Slack assistant: could not infer the organization");
    }
    if (inferred) {
      target = await resolveSlackAssistantTarget({
        requireAssistantEnabled: true,
        teamId,
        channelId,
        slackUserId,
        organizationId: inferred,
      });
    } else {
      const picker = await saveSlackOrganizationPicker(mention, target.choices);
      if (picker.status === "pending") {
        await postSlackEphemeralMessage({
          token: target.botToken,
          channel: channelId,
          user: slackUserId,
          text: target.message,
          blocks: slackOrganizationPickerBlocks(picker),
          threadTs: mention.threadTs,
        });
        return;
      }
      target = await resolveSlackAssistantTarget({
        requireAssistantEnabled: true,
        teamId,
        channelId,
        slackUserId,
        organizationId: picker.organizationId,
      });
    }
  }
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
  const label = organizationLabel(target);
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

  if (!question) {
    if (mention.requireActiveThread) return;
    await reply(
      "Ask me about your experiments, features, or metrics — e.g. *what experiments are running right now?*",
    );
    return;
  }

  const pinned = await pinSlackThreadOrganization(
    threadIdentity,
    target.organizationId,
  );
  if (
    pinned.status !== "selected" ||
    pinned.organizationId !== target.organizationId
  ) {
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
    const mrkdwn = toSlackMrkdwn(text, { appOrigin: APP_ORIGIN }) + label;
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
  /** Slack action timestamp identifies a click; retries of that delivery reuse it. */
  interactionTs?: string;
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
  const thread = threadTs
    ? await getSlackThread({ teamId, channelId, rootTs: threadTs })
    : null;
  if (thread?.status !== "selected") {
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
    channelId,
    slackUserId,
    organizationId: thread.organizationId,
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
  const label = organizationLabel(target);

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

  let alreadySubmitted = false;
  try {
    const result = await runAgentTurnToCompletion({
      context: target.context,
      config: slackAgentConfig,
      beforeResolvePendingAction: async () => {
        const current = await resolveSlackAssistantTarget({
          requireAssistantEnabled: true,
          teamId,
          channelId,
          slackUserId,
          organizationId: thread.organizationId,
        });
        if (
          !current.ok ||
          !current.assistantEnabled ||
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
          !(await claimSlackTask(
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
    if (!result.ok) {
      await postSlackMessage({
        token,
        channel: channelId,
        text: toSlackMrkdwn(result.message, { appOrigin: APP_ORIGIN }) + label,
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
      text:
        toSlackMrkdwn(
          result.reply ||
            (decision === "confirm" ? "Done." : "Okay, cancelled."),
          { appOrigin: APP_ORIGIN },
        ) + label,
      threadTs,
    });
  } catch (e) {
    logger.error(e, "Slack assistant confirmation failed");
    await postSlackMessage({
      token,
      channel: channelId,
      text:
        (alreadySubmitted
          ? "This action has already been submitted. Check GrowthBook before requesting it again."
          : "Something went wrong applying that change.") + label,
      threadTs,
    });
  }
}

export async function handleSlackOrganizationSelection(
  selection: SlackOrganizationSelection,
): Promise<void> {
  const target = await resolveSlackAssistantTarget({
    requireAssistantEnabled: true,
    teamId: selection.teamId,
    channelId: selection.channelId,
    slackUserId: selection.slackUserId,
    organizationId: selection.organizationId,
  });
  const mention =
    target.ok && target.assistantEnabled
      ? await consumeSlackOrganizationSelection(selection, target.linkId)
      : null;
  if (!mention) {
    if (target.botToken)
      await postSlackEphemeralMessage({
        token: target.botToken,
        channel: selection.channelId,
        user: selection.slackUserId,
        threadTs: selection.threadTs,
        text: "This organization choice is no longer available to you. Send your question again to get current choices.",
      });
    return;
  }
  await handleSlackAssistantMention(mention);
}
