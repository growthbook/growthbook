import Agenda, { Job } from "agenda";
import { logger } from "back-end/src/util/logger";

// Shared harness for the "poll for due scheduled publishes → queue a per-item
// publish job" pattern. Both the feature flow (updateScheduledPublishes) and the
// generic entity-revision flow (updateScheduledRevisionPublishes) register
// through this, so the Agenda plumbing — the repeating poller, per-item dedup,
// scheduling, and error logging — lives in exactly one place.
//
// Agenda keys handlers by name, and a later define() for the same name silently
// overwrites the earlier one (dropping that flow's jobs). We track registered
// names and throw on a collision so that class of bug fails loudly at boot
// rather than silently swallowing scheduled publishes.
const registeredJobNames = new Set<string>();

type ScheduledPublishJobConfig<TData extends Record<string, unknown>> = {
  // Globally-unique Agenda job names for the poller and the per-item publisher.
  queueJobName: string;
  publishJobName: string;
  pollIntervalMinutes?: number;
  // Items whose scheduled publish is due now. Each returned object is BOTH the
  // job payload and its dedup key, so overlapping ticks and multiple back-end
  // instances can't double-queue the same item.
  findDue: (now: Date) => Promise<TData[]>;
  // Short label for error logs, e.g. `feature abc v3 (org org_1)`.
  describeItem: (data: TData) => string;
  // Publish one due item. Must re-check the due gate + governance itself and be
  // safe to re-run (a stale re-fire after a success should no-op).
  publish: (job: Job<TData>) => Promise<void>;
};

export async function registerScheduledPublishJob<
  TData extends Record<string, unknown>,
>(
  agenda: Agenda,
  {
    queueJobName,
    publishJobName,
    pollIntervalMinutes = 1,
    findDue,
    describeItem,
    publish,
  }: ScheduledPublishJobConfig<TData>,
): Promise<void> {
  for (const name of [queueJobName, publishJobName]) {
    if (registeredJobNames.has(name)) {
      throw new Error(
        `Duplicate scheduled-publish Agenda job name "${name}". Names must be ` +
          `unique across flows, otherwise one handler silently swallows the ` +
          `other's jobs.`,
      );
    }
    registeredJobNames.add(name);
  }

  agenda.define(queueJobName, async () => {
    const due = await findDue(new Date());
    for (const data of due) {
      try {
        const job = agenda.create(publishJobName, data) as Job<TData>;
        job.unique({ ...data });
        job.schedule(new Date());
        await job.save();
      } catch (e) {
        logger.error(
          e,
          `Error queuing scheduled publish for ${describeItem(data)}`,
        );
      }
    }
  });

  agenda.define(publishJobName, publish);

  const poller = agenda.create(queueJobName, {});
  poller.unique({});
  poller.repeatEvery(`${pollIntervalMinutes} minutes`);
  await poller.save();
}
