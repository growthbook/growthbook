import Agenda, { Job } from "agenda";
import mongoose from "mongoose";
import { setupApp } from "back-end/test/api/api.setup";
import {
  AGENDA_DEFAULT_POLL_INTERVAL_MS,
  getAgendaInstance,
  getEventAgendaInstance,
} from "back-end/src/services/queueing";
import { EventNotifier } from "back-end/src/events/notifiers/EventNotifier";
import { EventWebHookNotifier } from "back-end/src/events/handlers/webhooks/EventWebHookNotifier";
import { getEventWebHookById } from "back-end/src/models/EventWebhookModel";
import { getLatestRunsForWebHook } from "back-end/src/models/EventWebHookLogModel";
import {
  EVENT_QUEUE_CONFIG,
  GB_AGENDA_DEFAULT_LOCK_LIMIT,
} from "back-end/src/util/secrets";
import {
  createFixture,
  startWebhookReceiver,
  waitUntil,
} from "./eventQueue.helpers";

const { isReady } = setupApp();

beforeEach(async () => {
  await isReady;
  await getEventAgendaInstance()._collection.deleteMany({});
});

it("drains persisted events with two workers while the background worker is full", async () => {
  await isReady;
  const background = getAgendaInstance();
  const events = getEventAgendaInstance();
  expect(background._definitions.eventCreated).toBeUndefined();
  expect(background._definitions.eventWebHook).toBeUndefined();
  expect(background._defaultLockLimit).toBe(GB_AGENDA_DEFAULT_LOCK_LIMIT);
  expect(background._processEvery).toBe(AGENDA_DEFAULT_POLL_INTERVAL_MS);
  expect(events._processEvery).toBe(EVENT_QUEUE_CONFIG.processEvery);

  let releaseBackground = () => {};
  const blocked = new Promise<void>((resolve) => {
    releaseBackground = resolve;
  });
  let startedBackground = 0;
  background.define(
    "blockedBackground",
    { concurrency: 20, lockLimit: 20 },
    async () => {
      startedBackground++;
      await blocked;
    },
  );
  const receiver = await startWebhookReceiver();
  const secondWorker = new Agenda({
    mongo: mongoose.connection.db,
    processEvery: `${EVENT_QUEUE_CONFIG.processEvery / 1000} seconds`,
    maxConcurrency: events._maxConcurrency,
  });
  EventNotifier.register(secondWorker);
  EventWebHookNotifier.register(secondWorker);
  const completedByWorker = [new Set<string>(), new Set<string>()];
  const onFirstWorkerComplete = (job: Job) => {
    completedByWorker[0].add(String(job.attrs._id));
  };
  const onSecondWorkerComplete = (job: Job) => {
    completedByWorker[1].add(String(job.attrs._id));
  };
  events.on("success:eventWebHook", onFirstWorkerComplete);
  secondWorker.on("success:eventWebHook", onSecondWorkerComplete);
  const failures: Error[] = [];
  events.on("fail", onFail);
  secondWorker.on("fail", onFail);
  function onFail(error: Error) {
    failures.push(error);
  }

  try {
    const { createEvent } = await createFixture(receiver.url);
    for (let i = 0; i < 24; i++) await createEvent({ metricId: `metric-${i}` });
    expect(
      await events._collection.countDocuments({ name: "eventCreated" }),
    ).toBe(24);

    for (let i = 0; i < 20; i++) await background.now("blockedBackground");
    await background.start();
    await waitUntil(() => startedBackground === 20);
    await Promise.all([events.start(), secondWorker.start()]);
    await waitUntil(async () => {
      if (failures.length) throw failures[0];
      return (
        (await events._collection.countDocuments({
          name: "eventWebHook",
          lastFinishedAt: { $ne: null },
        })) === 24
      );
    });
    await waitUntil(
      () => completedByWorker[0].size + completedByWorker[1].size === 24,
    );
    expect(completedByWorker[0].size).toBeGreaterThan(0);
    expect(completedByWorker[1].size).toBeGreaterThan(0);
    expect(
      new Set([...completedByWorker[0], ...completedByWorker[1]]).size,
    ).toBe(24);
    expect(receiver.received).toHaveLength(24);
    expect(new Set(receiver.received).size).toBe(24);
    expect(background._runningJobs).toHaveLength(20);
    expect(failures).toEqual([]);
    expect(
      await events._collection.countDocuments({ name: "eventWebHook" }),
    ).toBe(24);
  } finally {
    releaseBackground();
    await waitUntil(() =>
      [background, events, secondWorker].every(
        (worker) => worker._runningJobs.length === 0,
      ),
    );
    await Promise.all([background.stop(), events.stop(), secondWorker.stop()]);
    events.off("fail", onFail);
    secondWorker.off("fail", onFail);
    events.off("success:eventWebHook", onFirstWorkerComplete);
    secondWorker.off("success:eventWebHook", onSecondWorkerComplete);
    await receiver.close();
  }
}, 40000);

it("delivers a persisted retry on a new worker after the first delivery fails", async () => {
  const events = getEventAgendaInstance();
  const receiver = await startWebhookReceiver([503, 200]);
  const restartedWorker = new Agenda({
    mongo: mongoose.connection.db,
    processEvery: `${EVENT_QUEUE_CONFIG.processEvery / 1000} seconds`,
    maxConcurrency: events._maxConcurrency,
  });
  EventNotifier.register(restartedWorker);
  EventWebHookNotifier.register(restartedWorker);

  try {
    const { org, webhook, createEvent } = await createFixture(receiver.url);
    const eventId = await createEvent({ metricId: "retry" });
    const firstAttemptStartedAt = Date.now();
    await events.start();
    const jobFilter = { name: "eventWebHook", "data.eventId": eventId };
    await waitUntil(async () => {
      const job = await events._collection.findOne(jobFilter);
      return job?.data.retryCount === 1 && events._runningJobs.length === 0;
    });
    await events.stop();

    const retry = await events._collection.findOne(jobFilter);
    if (!retry?.nextRunAt) throw new Error("Missing persisted retry");
    expect(retry.nextRunAt.getTime()).toBeGreaterThanOrEqual(
      firstAttemptStartedAt + 30000,
    );
    expect(retry.lockedAt).toBeNull();
    expect(receiver.received).toHaveLength(1);
    expect(await getEventWebHookById(webhook.id, org.id)).toMatchObject({
      lastState: "error",
    });

    // Make the persisted retry due without waiting through the 30-second backoff.
    await events._collection.updateOne(
      { _id: retry._id },
      { $set: { nextRunAt: new Date() } },
    );
    await restartedWorker.start();
    await waitUntil(async () => {
      const job = await events._collection.findOne({ _id: retry._id });
      return (
        receiver.received.length === 2 &&
        job?.nextRunAt === null &&
        job.lockedAt === null &&
        restartedWorker._runningJobs.length === 0
      );
    });
    await restartedWorker.stop();

    expect(receiver.received).toEqual([
      receiver.received[0],
      receiver.received[0],
    ]);
    expect(await events._collection.countDocuments(jobFilter)).toBe(1);
    expect(await events._collection.findOne({ _id: retry._id })).toMatchObject({
      data: { retryCount: 1 },
      nextRunAt: null,
      lockedAt: null,
    });
    expect(await getEventWebHookById(webhook.id, org.id)).toMatchObject({
      lastState: "success",
    });
    const logs = await getLatestRunsForWebHook(org.id, webhook.id);
    expect(
      logs.map(({ result, responseCode }) => ({ result, responseCode })),
    ).toEqual([
      { result: "success", responseCode: 200 },
      { result: "error", responseCode: 503 },
    ]);
  } finally {
    await Promise.all([events.drain(), restartedWorker.drain()]);
    await Promise.all([events.stop(), restartedWorker.stop()]);
    await receiver.close();
  }
}, 40000);
