import Agenda, { Job } from "agenda";
import { logger } from "back-end/src/util/logger";
import {
  handleSlackAssistantMention,
  handleSlackAssistantConfirmation,
  SlackAssistantMention,
  SlackAssistantConfirmation,
} from "back-end/src/services/slack/slackAssistant";
import {
  handleSlackLinkShared,
  SlackLinkShared,
} from "back-end/src/services/slack/slackUnfurl";

// Durable processing for the interactive Slack assistant. The Events /
// Interactions endpoints must ACK within 3s, but answering a mention or
// unfurling a link can take many seconds. Enqueuing an Agenda job (persisted
// in Mongo on creation) means the work survives a web-process restart/crash
// instead of being dropped like a fire-and-forget promise.
//
// The handlers post user-facing messages and are NOT idempotent (a retry would
// post a duplicate reply), so the job has no automatic retry on failure.

const SLACK_ASSISTANT_JOB_NAME = "slackAssistantTask";

// One job type with a discriminated payload serves all three interaction
// kinds. `dedupeKey` + job.unique stops a Slack re-delivery from spawning a
// second pending job.
type SlackAssistantTaskData = { dedupeKey?: string } & (
  | { kind: "mention"; mention: SlackAssistantMention }
  | { kind: "confirmation"; confirmation: SlackAssistantConfirmation }
  | { kind: "unfurl"; event: SlackLinkShared }
);

type SlackAssistantJob = Job<SlackAssistantTaskData>;

const processSlackAssistantTask = async (job: SlackAssistantJob) => {
  const data = job.attrs.data;
  if (!data) return;

  logger.info({ kind: data.kind }, "Slack task: processing from queue");

  switch (data.kind) {
    case "mention":
      await handleSlackAssistantMention(data.mention);
      return;
    case "confirmation":
      await handleSlackAssistantConfirmation(data.confirmation);
      return;
    case "unfurl":
      await handleSlackLinkShared(data.event);
      return;
    default:
      logger.error(
        { kind: (data as { kind?: string }).kind },
        "Unknown Slack assistant task kind",
      );
  }
};

let agenda: Agenda;
export default function addSlackAssistantJobs(ag: Agenda) {
  agenda = ag;
  // Default lock lifetime (10m) and concurrency are fine for the slow agent
  // turn + PNG render.
  agenda.define(SLACK_ASSISTANT_JOB_NAME, processSlackAssistantTask);
}

async function enqueue(
  data: SlackAssistantTaskData,
  dedupeKey?: string,
): Promise<void> {
  if (!agenda) {
    logger.error("Slack assistant queue not initialized; dropping task");
    return;
  }
  const job = agenda.create(SLACK_ASSISTANT_JOB_NAME, {
    ...data,
    dedupeKey,
  }) as SlackAssistantJob;
  // Collapse a duplicate delivery into the existing pending job. Once the job
  // runs and is removed, an identical key can enqueue again (a genuinely new
  // interaction).
  if (dedupeKey) job.unique({ "data.dedupeKey": dedupeKey });
  job.schedule(new Date());
  await job.save();
}

export async function queueSlackAssistantMention(
  mention: SlackAssistantMention,
  dedupeKey?: string,
): Promise<void> {
  await enqueue({ kind: "mention", mention }, dedupeKey);
}

export async function queueSlackAssistantConfirmation(
  confirmation: SlackAssistantConfirmation,
): Promise<void> {
  // Button clicks carry no Slack event_id; dedupe on the conversation + action
  // so a double-click can't park two replays of the same decision.
  const dedupeKey = `confirm:${confirmation.conversationId}:${confirmation.actionId}`;
  await enqueue({ kind: "confirmation", confirmation }, dedupeKey);
}

export async function queueSlackLinkUnfurl(
  event: SlackLinkShared,
  dedupeKey?: string,
): Promise<void> {
  await enqueue({ kind: "unfurl", event }, dedupeKey);
}
