import { ReqContext } from "back-end/types/request";
import { addSlackChannelToWorkspace } from "back-end/src/services/slackIntegration";
import {
  createEventWebHook,
  getAllEventWebHooks,
} from "back-end/src/models/EventWebhookModel";
import {
  getSlackConversation,
  joinSlackConversation,
  listSlackConversations,
} from "back-end/src/services/slack/slackWebApi";

jest.mock("back-end/src/models/EventWebhookModel", () => ({
  createEventWebHook: jest.fn(),
  getAllEventWebHooks: jest.fn(),
}));
jest.mock("back-end/src/services/slack/slackWebApi", () => ({
  getSlackConversation: jest.fn(),
  joinSlackConversation: jest.fn(),
  listSlackConversations: jest.fn(),
  SLACK_WORKSPACE_PLACEHOLDER_URL: "https://slack.com",
}));
const context = {
  org: { id: "org-1" },
  models: {
    slackWorkspaceConnections: {
      getAll: async () => [
        { teamId: "T1", encryptedBotAccessToken: "xoxb-token" },
      ],
    },
  },
} as unknown as ReqContext;
const add = () =>
  addSlackChannelToWorkspace({ context, teamId: "T1", channelId: "C1" });
beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(getAllEventWebHooks).mockResolvedValue([]);
  jest.mocked(createEventWebHook).mockResolvedValue({ id: "created" } as never);
});
it("connects an invited private channel without pagination or joining", async () => {
  jest.mocked(getSlackConversation).mockResolvedValue({
    id: "C1",
    name: "private-alerts",
    isPrivate: true,
    isMember: true,
  });
  await expect(add()).resolves.toMatchObject({ id: "created" });
  expect(getSlackConversation).toHaveBeenCalledWith({
    token: "xoxb-token",
    channelId: "C1",
  });
  expect(listSlackConversations).not.toHaveBeenCalled();
  expect(joinSlackConversation).not.toHaveBeenCalled();
});
it("joins a public channel before saving its destination", async () => {
  jest.mocked(getSlackConversation).mockResolvedValue({
    id: "C1",
    name: "alerts",
    isPrivate: false,
    isMember: false,
  });
  jest
    .mocked(joinSlackConversation)
    .mockResolvedValue({ ok: true, error: null });
  await expect(add()).resolves.toMatchObject({ id: "created" });
  expect(joinSlackConversation).toHaveBeenCalledWith({
    token: "xoxb-token",
    channelId: "C1",
  });
});
it("requires an invitation for private channels", async () => {
  jest.mocked(getSlackConversation).mockResolvedValue({
    id: "C1",
    name: "private-alerts",
    isPrivate: true,
    isMember: false,
  });
  await expect(add()).rejects.toThrow("/invite @GrowthBook");
  expect(createEventWebHook).not.toHaveBeenCalled();
  expect(joinSlackConversation).not.toHaveBeenCalled();
});
it("does not save an inaccessible channel", async () => {
  jest.mocked(getSlackConversation).mockResolvedValue(null);
  await expect(add()).rejects.toThrow("Slack channel not found");
  expect(createEventWebHook).not.toHaveBeenCalled();
});
