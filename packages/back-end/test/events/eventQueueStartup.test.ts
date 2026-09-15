import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { queueInit } from "back-end/src/init/queue";
import {
  getAgendaInstance,
  getEventAgendaInstance,
} from "back-end/src/services/queueing";
import {
  createFixture,
  startWebhookReceiver,
  waitUntil,
} from "./eventQueue.helpers";

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  CRON_ENABLED: true,
}));

it("starts delivery of persisted events and webhooks without a producer", async () => {
  const mongodb = await MongoMemoryServer.create();
  await mongoose.connect(mongodb.getUri());
  const receiver = await startWebhookReceiver();
  const background = getAgendaInstance();
  // Keep unrelated background jobs out of this worker startup test.
  const backgroundStart = jest.spyOn(background, "start").mockResolvedValue();

  try {
    const { webhook, createEvent } = await createFixture(receiver.url);
    const eventId = await createEvent({
      metricId: "event-backlog",
      notify: false,
    });
    const webhookEventId = await createEvent({
      metricId: "webhook-backlog",
      notify: false,
    });
    // Raw rows reproduce a backlog left by a previous process without registering handlers.
    const jobs = mongoose.connection.collection("agendaJobs");
    await jobs.insertMany([
      {
        name: "eventCreated",
        type: "normal",
        data: { eventId },
        // Fan-out must not register the webhook handler before startup proves it can deliver.
        disabled: true,
        nextRunAt: new Date(),
        lockedAt: null,
      },
      {
        name: "eventWebHook",
        type: "normal",
        data: {
          eventId: webhookEventId,
          eventWebHookId: webhook.id,
          retryCount: 0,
        },
        nextRunAt: new Date(),
        lockedAt: null,
      },
    ]);

    await queueInit();
    await waitUntil(
      async () =>
        (await jobs.countDocuments({
          name: "eventWebHook",
          "data.eventId": webhookEventId,
          lastFinishedAt: { $ne: null },
          lockedAt: null,
        })) === 1,
    );
    expect(receiver.received).toEqual([
      expect.stringContaining('"metricId":"webhook-backlog"'),
    ]);
    await jobs.updateOne(
      { name: "eventCreated", "data.eventId": eventId },
      { $set: { disabled: false } },
    );
    await waitUntil(
      async () =>
        (await jobs.countDocuments({
          name: "eventWebHook",
          lastFinishedAt: { $ne: null },
          nextRunAt: null,
          lockedAt: null,
        })) === 2,
    );
    expect(receiver.received).toHaveLength(2);
    expect(receiver.received).toEqual(
      expect.arrayContaining([
        expect.stringContaining('"metricId":"event-backlog"'),
        expect.stringContaining('"metricId":"webhook-backlog"'),
      ]),
    );
    expect(await jobs.countDocuments({ failedAt: { $exists: true } })).toBe(0);
    expect(await jobs.countDocuments({ name: "eventCreated" })).toBe(1);
    expect(await jobs.countDocuments({ name: "eventWebHook" })).toBe(2);
  } finally {
    await getEventAgendaInstance().drain();
    await Promise.all([background.stop(), getEventAgendaInstance().stop()]);
    backgroundStart.mockRestore();
    await receiver.close();
    await mongoose.disconnect();
    await mongodb.stop();
  }
}, 60000);
