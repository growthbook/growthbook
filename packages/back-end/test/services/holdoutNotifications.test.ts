import type { HoldoutInterface } from "shared/validators";
import {
  holdoutCreatedNotificationPayload,
  holdoutNewLinkageNotificationPayload,
  holdoutStatusChangedNotificationPayload,
} from "shared/validators";
import type { NotificationEvent } from "shared/types/events/notification-events";
import type { Context } from "back-end/src/models/BaseModel";
import { createEvent } from "back-end/src/models/EventModel";
import {
  notifyHoldoutCreated,
  notifyHoldoutNewLinkage,
  notifyHoldoutStatusChanged,
} from "back-end/src/services/holdoutNotifications";
import { getSlackMessageForNotificationEvent } from "back-end/src/events/handlers/slack/slack-event-handler-utils";

jest.mock("back-end/src/models/EventModel", () => ({ createEvent: jest.fn() }));
const context = { org: { id: "org" } } as Context;
const linked = (id: string) => ({ id, dateAdded: new Date() });
const holdout = {
  id: "hld/1",
  name: "Checkout <!channel>",
  projects: ["prj"],
  environmentSettings: {
    production: { enabled: true },
    staging: { enabled: false },
  },
  linkedFeatures: { existing: linked("existing") },
  linkedExperiments: {},
} as unknown as HoldoutInterface;
beforeEach(() => jest.clearAllMocks());

it("announces creation with the holdout ID, scope, and Slack link", async () => {
  await notifyHoldoutCreated({ context, holdout });
  expect(createEvent).toHaveBeenCalledTimes(1);
  const event = jest.mocked(createEvent).mock.calls[0][0];
  expect(event).toMatchObject({
    object: "holdout",
    objectId: holdout.id,
    event: "created",
    projects: ["prj"],
    environments: ["production"],
  });
  expect(
    holdoutCreatedNotificationPayload.safeParse(event.data.object).success,
  ).toBe(true);
  const message = await getSlackMessageForNotificationEvent(
    { event: "holdout.created", data: event.data } as NotificationEvent,
    "event",
  );
  expect(message?.text).toBe(`${holdout.name}: Holdout created.`);
  expect(message?.blocks[1]).toMatchObject({
    elements: [{ url: expect.stringContaining("/holdout/hld%2F1") }],
  });
});

it("reports only newly linked items, with holdout scope and a Slack holdout link", async () => {
  await notifyHoldoutNewLinkage({
    context,
    previous: holdout,
    holdout: {
      ...holdout,
      linkedFeatures: {
        ...holdout.linkedFeatures,
        checkout: linked("checkout"),
      },
      linkedExperiments: { exp1: linked("exp1") },
    },
  });
  expect(createEvent).toHaveBeenCalledTimes(1);
  const event = jest.mocked(createEvent).mock.calls[0][0];
  expect(event).toMatchObject({
    object: "holdout",
    objectId: holdout.id,
    event: "config.newLinkage",
    projects: ["prj"],
    environments: ["production"],
    data: { object: { featureIds: ["checkout"], experimentIds: ["exp1"] } },
  });
  expect(
    holdoutNewLinkageNotificationPayload.safeParse(event.data.object).success,
  ).toBe(true);
  const message = await getSlackMessageForNotificationEvent(
    {
      event: "holdout.config.newLinkage",
      data: event.data,
    } as NotificationEvent,
    "event",
  );
  expect(message?.text).toContain(
    "Linked Feature Flags: checkout. Linked experiments: exp1.",
  );
  expect(message?.blocks[0]).toMatchObject({ text: { type: "plain_text" } });
  expect(message?.blocks[1]).toMatchObject({
    elements: [{ url: expect.stringContaining("/holdout/hld%2F1") }],
  });
});

it("does not notify removals, metadata edits, or repeated linkage", async () => {
  await notifyHoldoutNewLinkage({
    context,
    previous: holdout,
    holdout: { ...holdout, name: "Renamed" },
  });
  await notifyHoldoutNewLinkage({
    context,
    previous: holdout,
    holdout: { ...holdout, linkedFeatures: {} },
  });
  await notifyHoldoutNewLinkage({
    context,
    previous: holdout,
    holdout: { ...holdout, linkedFeatures: { existing: linked("existing") } },
  });
  expect(createEvent).not.toHaveBeenCalled();
});

it.each([
  ["draft", "running"],
  ["running", "analysis-period"],
  ["analysis-period", "stopped"],
] as const)("renders %s → %s", async (previousStatus, currentStatus) => {
  await notifyHoldoutStatusChanged({
    context,
    holdout,
    previousStatus,
    currentStatus,
  });
  const event = jest.mocked(createEvent).mock.calls[0][0];
  expect(
    holdoutStatusChangedNotificationPayload.safeParse(event.data.object)
      .success,
  ).toBe(true);
  const message = await getSlackMessageForNotificationEvent(
    { event: "holdout.status.changed", data: event.data } as NotificationEvent,
    "event",
  );
  expect(message?.text).toContain(
    `Status changed from ${previousStatus.replace("analysis-period", "analysis period")} to ${currentStatus.replace("analysis-period", "analysis period")}.`,
  );
});

it("does not emit a status event for an unchanged stage", async () => {
  await notifyHoldoutStatusChanged({
    context,
    holdout,
    previousStatus: "running",
    currentStatus: "running",
  });
  expect(createEvent).not.toHaveBeenCalled();
});
