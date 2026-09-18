import Agenda, { Job } from "agenda";
import { logger } from "back-end/src/util/logger";
import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import { postSlackEphemeralMessage } from "back-end/src/services/slack/slackWebApi";
import { slackAssistantMentionSchema } from "back-end/src/services/slack/slackThreadRouting";
import {
  claimSlackTask,
  getSlackTaskClaimAge,
  releaseSlackTask,
  slackTaskKey,
  isDuplicateKeyError,
} from "back-end/src/services/slack/slackTaskSafety";
import {
  handleSlackAssistantMention,
  handleSlackAssistantConfirmation,
  SlackAssistantMention,
  SlackAssistantConfirmation,
} from "back-end/src/services/slack/slackAssistant";

const SLACK_ASSISTANT_JOB_NAME = "slackAssistantTask";

// One job type with a discriminated payload serves the interaction
// kinds. `dedupeKey` + job.unique stops a Slack re-delivery from spawning a
// second pending job.
type SlackAssistantTaskData = { dedupeKey?: string } & (
  | { kind: "mention"; mention: SlackAssistantMention }
  | { kind: "confirmation"; confirmation: SlackAssistantConfirmation }
);

type SlackAssistantJob = Job<SlackAssistantTaskData>;

const processSlackAssistantTask = async (job: SlackAssistantJob) => {
  const data = job.attrs.data;
  if (!data || (data.kind !== "mention" && data.kind !== "confirmation"))
    return;
  const task = data.kind === "mention" ? data.mention : data.confirmation;
  const rootTs =
    data.kind === "mention"
      ? data.mention.threadTs || data.mention.messageTs
      : data.confirmation.threadTs || "";
  const lockKey = `thread:${slackTaskKey([task.teamId, task.channelId, rootTs])}`;
  if (!(await claimSlackTask(lockKey))) {
    const age = await getSlackTaskClaimAge(lockKey);
    if (age !== null && age > 15 * 60 * 1000) {
      logger.error(
        { lockKey },
        "Slack thread is blocked by an interrupted or long-running turn; manual recovery required",
      );
      const target = await resolveSlackAssistantTarget({
        teamId: task.teamId,
        slackUserId: task.slackUserId,
      });
      if (target.botToken)
        await postSlackEphemeralMessage({
          token: target.botToken,
          channel: task.channelId,
          user: task.slackUserId,
          text: "A previous request in this thread is still running or was interrupted. Ask your GrowthBook administrator to check it before retrying.",
          threadTs: rootTs,
        });
      throw new Error(`Slack thread requires operator recovery: ${lockKey}`);
    }
    job.schedule(new Date(Date.now() + 5000));
    await job.save();
    return;
  }
  try {
    switch (data.kind) {
      case "mention":
        await handleSlackAssistantMention(
          slackAssistantMentionSchema.parse(data.mention),
        );
        return;
      case "confirmation":
        await handleSlackAssistantConfirmation(data.confirmation);
        return;
    }
  } finally {
    // Do not expire a live lock: a paused worker could resume and replay a mutation.
    // A process crash requires operator recovery of its orphaned thread claim.
    await releaseSlackTask(lockKey);
  }
};

let agenda: Agenda;
let indexReady: Promise<string> | null = null;
export default function addSlackAssistantJobs(ag: Agenda) {
  agenda = ag;
  indexReady = null;
  // Thread claims serialize turns independently of Agenda job locks.
  agenda.define(SLACK_ASSISTANT_JOB_NAME, processSlackAssistantTask);
}

async function enqueue(
  data: SlackAssistantTaskData,
  dedupeKey?: string,
): Promise<void> {
  if (!agenda) {
    throw new Error("Slack assistant queue not initialized");
  }
  if (!dedupeKey) throw new Error("Slack task requires a delivery identity");
  indexReady ??= agenda._collection
    .createIndex(
      { name: 1, "data.dedupeKey": 1 },
      {
        unique: true,
        name: "slack_assistant_delivery",
        partialFilterExpression: { name: SLACK_ASSISTANT_JOB_NAME },
      },
    )
    .catch((error: unknown) => {
      indexReady = null;
      throw error;
    });
  await indexReady;
  const job = agenda.create(SLACK_ASSISTANT_JOB_NAME, {
    ...data,
    dedupeKey,
  }) as SlackAssistantJob;
  // Completed Agenda jobs remain for seven days; a retry never reschedules one.
  job.unique({ "data.dedupeKey": dedupeKey }, { insertOnly: true });
  job.schedule(new Date());
  try {
    await job.save();
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
  }
}

export async function queueSlackAssistantMention(
  mention: SlackAssistantMention,
  dedupeKey?: string,
): Promise<void> {
  await enqueue(
    { kind: "mention", mention },
    `mention:${slackTaskKey([mention.teamId, dedupeKey || mention.channelId + ":" + mention.messageTs])}`,
  );
}

export async function queueSlackAssistantConfirmation(
  confirmation: SlackAssistantConfirmation,
): Promise<void> {
  if (!confirmation.interactionTs) {
    throw new Error("Slack confirmation requires an interaction timestamp");
  }
  // Retry deliveries reuse action_ts; a fresh click may retry a preflight
  // failure. The permanent action claim separately prevents mutation replay.
  const dedupeKey = `confirm:${slackTaskKey([confirmation.teamId, confirmation.channelId, confirmation.slackUserId, confirmation.conversationId, confirmation.actionId, confirmation.interactionTs])}`;
  await enqueue({ kind: "confirmation", confirmation }, dedupeKey);
}
