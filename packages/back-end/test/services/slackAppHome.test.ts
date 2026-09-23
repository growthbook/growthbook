import { vi } from "vitest";
import {
  handleSlackAppHomeOpened,
  slackAppHomeOpenedEventSchema,
} from "back-end/src/services/slack/slackAppHome";
import { getSlackWorkspaceBotToken } from "back-end/src/services/slack/slackIdentity";
import { cancellableFetch } from "back-end/src/util/http.util";

vi.mock("back-end/src/services/slack/slackIdentity", () => ({
  getSlackWorkspaceBotToken: vi.fn(),
}));
vi.mock("back-end/src/util/http.util", () => ({
  cancellableFetch: vi.fn(),
}));

const payload = {
  type: "event_callback",
  team_id: "T123",
  event_id: "Ev123",
  event: {
    type: "app_home_opened",
    tab: "messages",
    channel: "D123",
    user: "U123",
    event_ts: "1700.123",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSlackWorkspaceBotToken).mockResolvedValue("xoxb-token");
  vi.mocked(cancellableFetch).mockResolvedValue({
    responseWithoutBody: { ok: true, status: 200 },
    stringBody: JSON.stringify({ ok: true }),
  });
});

test("sets Messages tab prompts on repeated opens without inventing a message timestamp", async () => {
  const appHome = slackAppHomeOpenedEventSchema.parse(payload);
  expect(appHome).toEqual({
    teamId: "T123",
    channelId: "D123",
    eventId: "Ev123",
  });

  await handleSlackAppHomeOpened(appHome);
  await handleSlackAppHomeOpened({ ...appHome, eventId: "Ev124" });

  expect(getSlackWorkspaceBotToken).toHaveBeenCalledWith("T123");
  expect(cancellableFetch).toHaveBeenCalledTimes(2);
  expect(cancellableFetch).toHaveBeenCalledWith(
    "https://slack.com/api/assistant.threads.setSuggestedPrompts",
    expect.objectContaining({
      method: "POST",
      headers: {
        Authorization: "Bearer xoxb-token",
        "Content-Type": "application/json; charset=utf-8",
      },
      body: JSON.stringify({
        channel_id: "D123",
        title: "Ask GrowthBook about your experiments and Feature Flags",
        prompts: [
          { title: "Link my account", message: "link account" },
          {
            title: "Running experiments",
            message: "What experiments are running right now?",
          },
          {
            title: "Feature Flags",
            message: "What Feature Flags do we have?",
          },
        ],
      }),
    }),
    expect.any(Object),
  );
});

test("does not call Slack after the workspace is disconnected", async () => {
  vi.mocked(getSlackWorkspaceBotToken).mockResolvedValue(null);
  await handleSlackAppHomeOpened(slackAppHomeOpenedEventSchema.parse(payload));
  expect(cancellableFetch).not.toHaveBeenCalled();
});

test.each(["home", "about", undefined])(
  "ignores opens outside the Messages tab: %p",
  (tab) => {
    expect(
      slackAppHomeOpenedEventSchema.safeParse({
        ...payload,
        event: { ...payload.event, tab },
      }).success,
    ).toBe(false);
  },
);

test.each([
  { ...payload, team_id: "" },
  { ...payload, event_id: "" },
  { ...payload, event: { ...payload.event, channel: null } },
  {
    ...payload,
    event: { ...payload.event, type: "assistant_thread_started" },
  },
])("rejects malformed and legacy events", (input) => {
  expect(slackAppHomeOpenedEventSchema.safeParse(input).success).toBe(false);
});
