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
// Interactions endpoints must ACK Slack within 3s, but answering a mention
// (running the AI agent) or unfurling a link (rendering a PNG) can take many
// seconds. Rather than running that work as a fire-and-forget promise in the
// web process — where a restart or crash would silently drop it — we enqueue
// an Agenda job. The job is persisted in Mongo the moment it's created, so it
// survives a restart and is picked up by whichever process runs the queue.
//
// These handlers post user-facing Slack messages and are NOT idempotent
// (retrying a mention would re-run the agent and post a duplicate reply), so
// this job intentionally has no automatic retry on failure.

const SLACK_ASSISTANT_JOB_NAME = "slackAssistantTask";

// A single job type with a discriminated payload keeps enqueuing simple and
// lets one worker slot serve all three interaction kinds. `dedupeKey` is used
// with job.unique so a Slack re-delivery doesn't spawn a second pending job.
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
  // The agent turn + PNG render is the slow, CPU-ish part; the default lock
  // lifetime (10m) is plenty and the default concurrency keeps a single worker
  // from running too many turns at once.
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
  // Collapse a duplicate delivery of the same event into the existing pending
  // job. Once the job runs and is removed, a later identical key can enqueue
  // again — which is the desired behavior for a genuinely new interaction.
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
