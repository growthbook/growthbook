import Agenda, { Job } from "agenda";
import { z } from "zod";
import {
  ensureIndexOnce,
  isDuplicateKeyError,
} from "back-end/src/util/mongo.util";
import {
  handleSlackAppHomeOpened,
  SlackAppHomeOpened,
  slackAppHomeOpenedSchema,
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
  slackAssistantMentionSchema,
  slackAssistantConfirmationSchema,
} from "back-end/src/services/slack/slackAssistant";

const SLACK_ASSISTANT_JOB_NAME = "slackAssistantTask";
const BUSY_RETRY_MS = 5000;

// One job type with a discriminated payload serves the interaction
// kinds. `dedupeKey` + job.unique stops a Slack re-delivery from spawning a
// second pending job.
const slackAssistantTaskSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mention"),
    mention: slackAssistantMentionSchema,
  }),
  z.object({
    kind: z.literal("confirmation"),
    confirmation: slackAssistantConfirmationSchema,
  }),
  z.object({
    kind: z.literal("appHomeOpened"),
    appHome: slackAppHomeOpenedSchema,
  }),
]);
type SlackAssistantTask = z.infer<typeof slackAssistantTaskSchema>;
type SlackAssistantJob = Job<SlackAssistantTask & { dedupeKey: string }>;

// Agenda saves job data with the driver's defaults, which store an absent
// optional field as BSON null. The payload schemas only know `undefined`.
const withoutNulls = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, v]) => v !== null)
      .map(([k, v]) => [k, withoutNulls(v)]),
  );
};

const processSlackAssistantTask = async (job: SlackAssistantJob) => {
  const task = slackAssistantTaskSchema.parse(withoutNulls(job.attrs.data));
  try {
    switch (task.kind) {
      case "appHomeOpened":
        await handleSlackAppHomeOpened(task.appHome);
        return;
      case "mention":
        await handleSlackAssistantMention(task.mention);
        return;
      case "confirmation":
        await handleSlackAssistantConfirmation(task.confirmation);
        return;
    }
  } catch (error) {
    if (error instanceof SlackThreadBusyError) {
      // Another worker holds this thread's lease; come back shortly. Keep the
      // placeholder the first attempt posted so the retry edits it in place.
      if (task.kind === "mention" && error.placeholderTs) {
        job.attrs.data = {
          dedupeKey: job.attrs.data.dedupeKey,
          kind: "mention",
          mention: { ...task.mention, placeholderTs: error.placeholderTs },
        };
      }
      job.schedule(new Date(Date.now() + BUSY_RETRY_MS));
      await job.save();
      return;
    }

    throw error;
  }
};

let agenda: Agenda;
export default function addSlackAssistantJobs(ag: Agenda) {
  agenda = ag;
  agenda.define(SLACK_ASSISTANT_JOB_NAME, processSlackAssistantTask);
}

async function enqueue(
  data: SlackAssistantTask,
  dedupeKey: string,
): Promise<void> {
  if (!agenda) {
    throw new Error("Slack assistant queue not initialized");
  }
  await ensureIndexOnce(
    agenda._collection,
    { name: 1, "data.dedupeKey": 1 },
    {
      unique: true,
      name: "slack_assistant_delivery",
      partialFilterExpression: { name: SLACK_ASSISTANT_JOB_NAME },
    },
  );
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
    // A job for this delivery already exists, which is the dedupe outcome.
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

export async function queueSlackAssistantMention({
  eventId,
  mention,
}: {
  /** Slack's event_id; a redelivery of the same event reuses it. */
  eventId: string;
  mention: SlackAssistantMention;
}): Promise<void> {
  await enqueue(
    { kind: "mention", mention },
    `mention:${slackTaskKey([mention.teamId, eventId])}`,
  );
}

export async function queueSlackAssistantConfirmation(
  confirmation: SlackAssistantConfirmation,
): Promise<void> {
  // Retry deliveries reuse action_ts; a fresh click may retry a preflight
  // failure. The permanent action claim separately prevents mutation replay.
  const dedupeKey = `confirm:${slackTaskKey([confirmation.teamId, confirmation.channelId, confirmation.slackUserId, confirmation.conversationId, confirmation.actionId, confirmation.interactionTs])}`;
  await enqueue({ kind: "confirmation", confirmation }, dedupeKey);
}
