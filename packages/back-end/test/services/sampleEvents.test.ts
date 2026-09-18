import {
  cardNotificationEventNames,
  previewNotificationEventNames,
} from "shared/notifications";
import { notificationEvents } from "shared/validators";
import { notificationCardEventNames } from "back-end/src/services/notificationCards/renderNotificationCard";
import {
  getSampleEventPayload,
  sampleNotificationEventNames,
} from "back-end/src/services/notifications/sampleEvents";

const eventSchemas = Object.entries(notificationEvents).flatMap(
  ([resource, events]) =>
    Object.entries(events).map(([event, definition]) => ({
      name: `${resource}.${event}`,
      schema: definition.schema,
    })),
);

const context = {
  userId: "user_test",
  email: "test@example.com",
  userName: "Test User",
};

test.each(previewNotificationEventNames)(
  "%s sample satisfies its canonical payload schema",
  (eventName) => {
    const schema = eventSchemas.find(({ name }) => name === eventName)?.schema;
    expect(schema).toBeDefined();
    const event = getSampleEventPayload({ context, eventName });
    expect(schema?.safeParse(event.data.object)).toEqual(
      expect.objectContaining({ success: true }),
    );
    expect(event.event).toBe(eventName);
    expect(event.object).toBe(eventName.split(".")[0]);
    expect(event.user).toEqual({
      type: "dashboard",
      id: context.userId,
      email: context.email,
      name: context.userName,
    });
  },
);

test("shared preview metadata exactly matches server sample factories", () => {
  expect([...sampleNotificationEventNames].sort()).toEqual(
    [...previewNotificationEventNames].sort(),
  );
});

test("shared card metadata exactly matches server producers", () => {
  expect([...notificationCardEventNames].sort()).toEqual(
    [...cardNotificationEventNames].sort(),
  );
});
