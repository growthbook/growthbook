import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import Agenda from "agenda";
import mongoose from "mongoose";
import { setupApp } from "back-end/test/api/api.setup";
import {
  getAgendaInstance,
  getEventAgendaInstance,
} from "back-end/src/services/queueing";
import { EventNotifier } from "back-end/src/events/notifiers/EventNotifier";
import { EventWebHookNotifier } from "back-end/src/events/handlers/webhooks/EventWebHookNotifier";
import { createOrganization } from "back-end/src/models/OrganizationModel";
import { createEventWebHook } from "back-end/src/models/EventWebhookModel";
import { createEventWithPayload } from "back-end/src/models/EventModel";
import * as slackHandler from "back-end/src/events/handlers/slack/slackEventHandler";
import { EVENT_QUEUE_CONFIG } from "back-end/src/util/secrets";

const { isReady } = setupApp();

jest.mock("back-end/src/events/handlers/slack/slackEventHandler", () => ({
  ...jest.requireActual("back-end/src/events/handlers/slack/slackEventHandler"),
  slackEventHandler: jest.fn(
    jest.requireActual("back-end/src/events/handlers/slack/slackEventHandler")
      .slackEventHandler,
  ),
}));

afterEach(() => jest.restoreAllMocks());

beforeEach(async () => {
  await isReady;
  await getEventAgendaInstance()._collection.deleteMany({});
});

async function waitUntil(ready: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 30000;
  while (!(await ready())) {
    if (Date.now() > deadline)
      throw new Error("Event queue did not make progress");
    await delay(10);
  }
}

async function createFixture(url: string, subscribers = 1) {
  const org = await createOrganization({
    email: "queue@example.test",
    userId: "queue-test",
    name: "Queue test",
  });
  for (let i = 0; i < subscribers; i++) {
    await createEventWebHook({
      name: `Webhook ${i}`,
      organizationId: org.id,
      url,
      enabled: true,
      events: ["experiment.info.significance"],
      projects: [],
      tags: [],
      environments: [],
      payloadType: "json",
      method: "POST",
      headers: {},
    });
  }
  return async (metricId: string) => {
    await createEventWithPayload({
      organizationId: org.id,
      payload: {
        event: "experiment.info.significance",
        object: "experiment",
        user: { type: "system" },
        projects: [],
        tags: [],
        environments: [],
        containsSecrets: false,
        data: {
          object: {
            experimentId: "exp-test",
            experimentName: "Queue test",
            metricId,
            metricName: metricId,
            variationId: "1",
            variationName: "Treatment",
            statsEngine: "bayesian",
            criticalValue: 0.99,
            winning: true,
          },
        },
      },
    });
  };
}

it("drains persisted events with two workers while the background worker is full", async () => {
  await isReady;
  const background = getAgendaInstance();
  const events = getEventAgendaInstance();
  expect(background._definitions.eventCreated).toBeUndefined();
  expect(background._definitions.eventWebHook).toBeUndefined();
  expect(background._defaultLockLimit).toBe(5);
  expect(background._processEvery).toBe(5000);
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
  const received: string[] = [];
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    received.push(body);
    res.end("ok");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new Error("Missing local receiver address");
  }
  const secondWorker = new Agenda({
    mongo: mongoose.connection.db,
    processEvery: `${EVENT_QUEUE_CONFIG.processEvery / 1000} seconds`,
    maxConcurrency: events._maxConcurrency,
  });
  EventNotifier.register(secondWorker);
  EventWebHookNotifier.register(secondWorker);
  const failures: Error[] = [];
  events.on("fail", onFail);
  secondWorker.on("fail", onFail);
  function onFail(error: Error) {
    failures.push(error);
  }

  try {
    const createEvent = await createFixture(`http://127.0.0.1:${address.port}`);
    for (let i = 0; i < 24; i++) await createEvent(`metric-${i}`);
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
    expect(received).toHaveLength(24);
    expect(new Set(received).size).toBe(24);
    expect(background._runningJobs).toHaveLength(20);
    expect(failures).toEqual([]);
    expect(
      await events._collection.countDocuments({ name: "eventWebHook" }),
    ).toBe(24);
  } finally {
    releaseBackground();
    await waitUntil(() => background._runningJobs.length === 0);
    await Promise.all([background.stop(), events.stop(), secondWorker.stop()]);
    events.off("fail", onFail);
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}, 40000);

it("waits for bounded fan-out and Slack even when one enqueue fails", async () => {
  await isReady;
  const events = getEventAgendaInstance();
  const createEvent = await createFixture("http://localhost/unused", 3);
  await createEvent("metric");
  const [job] = await events.jobs({ name: "eventCreated" });

  let releaseEnqueue = () => {};
  const enqueuePending = new Promise<void>((resolve) => {
    releaseEnqueue = resolve;
  });
  let releaseSlack = () => {};
  const slackPending = new Promise<void>((resolve) => {
    releaseSlack = resolve;
  });
  let active = 0;
  let peak = 0;
  let attempts = 0;
  const failure = new Error("Injected enqueue failure");
  const enqueue = jest
    .spyOn(EventWebHookNotifier.prototype, "enqueue")
    .mockImplementation(async () => {
      attempts++;
      active++;
      peak = Math.max(peak, active);
      await enqueuePending;
      active--;
      if (attempts === 2) throw failure;
    });
  jest.mocked(slackHandler.slackEventHandler).mockReturnValueOnce(slackPending);
  const run = events._definitions.eventCreated.fn(job, () => {});
  let finished = false;
  const settled = Promise.resolve(run).catch((error: unknown) => {
    finished = true;
    return error;
  });
  try {
    await waitUntil(() => enqueue.mock.calls.length > 0);
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(finished).toBe(false);
    releaseEnqueue();
    await waitUntil(() => attempts === 3);
    expect(finished).toBe(false);
    releaseSlack();
    expect(await settled).toBe(failure);
    expect(peak).toBe(1);
    expect(attempts).toBe(3);
  } finally {
    releaseEnqueue();
    releaseSlack();
    await settled;
  }
});
