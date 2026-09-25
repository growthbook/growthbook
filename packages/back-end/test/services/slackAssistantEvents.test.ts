import { getSlackAssistantEvent } from "back-end/src/services/slack/slackAssistantEvents";

const envelope = {
  type: "event_callback",
  team_id: "T1",
  event_id: "Ev1",
  authorizations: [{ user_id: "UBOT", is_bot: true }],
};
const message = {
  user: "U1",
  channel: "C1",
  ts: "123.456",
  text: "Which experiments are running?",
};

describe("Slack assistant event routing", () => {
  it.each(["channel", "group"])(
    "accepts explicit mentions in a %s, including existing threads",
    (channelType) => {
      for (const threadTs of [undefined, "100.000"]) {
        expect(
          getSlackAssistantEvent({
            ...envelope,
            event: {
              ...message,
              type: "app_mention",
              channel_type: channelType,
              text: `<@UBOT> ${message.text}`,
              thread_ts: threadTs,
            },
          }),
        ).toEqual({
          eventId: "Ev1",
          mention: {
            teamId: "T1",
            channelId: "C1",
            slackUserId: "U1",
            text: `<@UBOT> ${message.text}`,
            messageTs: "123.456",
            threadTs,
            botUserId: "UBOT",
          },
        });
      }
    },
  );

  it.each(["channel", "group", "mpim", undefined])(
    "discards ordinary %s messages and thread replies, including duplicate mentions",
    (channelType) => {
      for (const threadTs of [undefined, "100.000"]) {
        for (const text of [message.text, `<@UBOT> ${message.text}`]) {
          expect(
            getSlackAssistantEvent({
              ...envelope,
              event: {
                ...message,
                type: "message",
                channel_type: channelType,
                thread_ts: threadTs,
                text,
              },
            }),
          ).toBeNull();
        }
      }
    },
  );

  it.each([message.text, `<@UBOT> ${message.text}`])(
    "accepts direct messages and DM thread replies containing %s",
    (text) => {
      for (const threadTs of [undefined, "100.000"]) {
        expect(
          getSlackAssistantEvent({
            ...envelope,
            event: {
              ...message,
              type: "message",
              channel_type: "im",
              channel: "D1",
              text,
              thread_ts: threadTs,
            },
          }),
        ).toMatchObject({
          eventId: "Ev1",
          mention: { channelId: "D1", text, threadTs },
        });
      }
    },
  );

  it.each([
    { bot_id: "B1" },
    { user: "UBOT" },
    { subtype: "message_changed" },
    { subtype: "message_deleted" },
    { subtype: "channel_join" },
  ])("ignores bot and system messages: %p", (overrides) => {
    for (const type of ["app_mention", "message"]) {
      expect(
        getSlackAssistantEvent({
          ...envelope,
          event: { ...message, type, channel_type: "im", ...overrides },
        }),
      ).toBeNull();
    }
  });

  it.each([
    null,
    {},
    { ...envelope, event: { ...message, type: "app_home_opened" } },
    { ...envelope, event: { ...message, type: "app_mention", text: 42 } },
    { ...envelope, event: { ...message, type: "app_mention", user: "" } },
    {
      ...envelope,
      team_id: "",
      event: { ...message, type: "app_mention" },
    },
    {
      ...envelope,
      event_id: undefined,
      event: { ...message, type: "app_mention" },
    },
  ])("does not queue malformed or unrelated events: %p", (payload) => {
    expect(getSlackAssistantEvent(payload)).toBeNull();
  });
});
