import Agenda, { Job } from "agenda";
import { isDuplicateKeyError } from "back-end/src/util/mongo.util";
import { slackAssistantMentionSchema } from "back-end/src/services/slack/slackThreadRouting";
import {
  handleSlackAppHomeOpened,
  SlackAppHomeOpened,
} from "back-end/src/services/slack/slackAppHome";
import {
  slackTaskKey,
  SlackThreadBusyError,
} from "back-end/src/services/slack/slackTaskSafety";
import {
  handleSlackAssistantMention,
  handleSlackAssistantConfirmation,
  SlackAssistantMention,
  SlackAssistantConfirmation,
} from "back-end/src/services/slack/slackAssistant";

const SLACK_ASSISTANT_JOB_NAME = "slackAssistantTask";
const BUSY_RETRY_MS = 5000;

// One job type with a discriminated payload serves the interaction
// kinds. `dedupeKey` + job.unique stops a Slack re-delivery from spawning a
// second pending job.
type SlackAssistantTaskData = { dedupeKey?: string } & (
  | { kind: "mention"; mention: SlackAssistantMention }
  | { kind: "confirmation"; confirmation: SlackAssistantConfirmation }
  | { kind: "appHomeOpened"; appHome: SlackAppHomeOpened }
);

type SlackAssistantJob = Job<SlackAssistantTaskData>;

const processSlackAssistantTask = async (job: SlackAssistantJob) => {
  const data = job.attrs.data;
  if (!data) return;
  try {
    switch (data.kind) {
      case "appHomeOpened":
        await handleSlackAppHomeOpened(data.appHome);
        return;
      case "mention":
        await handleSlackAssistantMention(
          slackAssistantMentionSchema.parse(data.mention),
        );
        return;
      case "confirmation":
        await handleSlackAssistantConfirmation(data.confirmation);
        return;
    }
  } catch (error) {
    if (!(error instanceof SlackThreadBusyError)) throw error;
    // Another turn holds the thread. Keep the placeholder the first attempt
    // posted so the retry does not post a second one.
    if (data.kind === "mention" && error.placeholderTs) {
      job.attrs.data = {
        ...data,
        mention: { ...data.mention, placeholderTs: error.placeholderTs },
      };
    }
    job.schedule(new Date(Date.now() + BUSY_RETRY_MS));
    await job.save();
  }
};

let agenda: Agenda;
let indexReady: Promise<string> | null = null;
export default function addSlackAssistantJobs(ag: Agenda) {
  agenda = ag;
  indexReady = null;
  // The queue wrapper renews the Agenda lock every nine minutes while a turn
  // runs (services/jobLifecycle.ts), so a long turn is never re-picked.
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

export async function queueSlackAppHomeOpened(
  appHome: SlackAppHomeOpened,
): Promise<void> {
  await enqueue(
    { kind: "appHomeOpened", appHome },
    `appHome:${slackTaskKey([appHome.teamId, appHome.eventId])}`,
  );
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
