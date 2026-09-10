import { vi } from "vitest";
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

vi.mock("back-end/src/models/EventWebhookModel", () => ({
  createEventWebHook: vi.fn(),
  getAllEventWebHooks: vi.fn(),
}));
vi.mock("back-end/src/services/slack/slackWebApi", () => ({
  getSlackConversation: vi.fn(),
  joinSlackConversation: vi.fn(),
  listSlackConversations: vi.fn(),
  SLACK_WORKSPACE_PLACEHOLDER_URL: "https://slack.com",
}));
const context = {
  org: { id: "org-1" },
  models: {
    slackWorkspaceConnections: {
      getAll: async () => [
        {
          teamId: "T1",
          teamName: "Workspace",
          appId: "A1",
          scope: "chat:write",
          encryptedBotAccessToken: "xoxb-token",
        },
      ],
    },
  },
} as unknown as ReqContext;
const add = () =>
  addSlackChannelToWorkspace({ context, teamId: "T1", channelId: "C1" });
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getAllEventWebHooks).mockResolvedValue([]);
  vi.mocked(createEventWebHook).mockResolvedValue({ id: "created" } as never);
});
it("connects an invited private channel without pagination or joining", async () => {
  vi.mocked(getSlackConversation).mockResolvedValue({
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
  expect(vi.mocked(createEventWebHook).mock.calls[0][0].slack).toEqual({
    teamId: "T1",
    channelId: "C1",
    channelName: "private-alerts",
  });
  expect(listSlackConversations).not.toHaveBeenCalled();
  expect(joinSlackConversation).not.toHaveBeenCalled();
});
it("joins a public channel before saving its destination", async () => {
  vi.mocked(getSlackConversation).mockResolvedValue({
    id: "C1",
    name: "alerts",
    isPrivate: false,
    isMember: false,
  });
  vi.mocked(joinSlackConversation).mockResolvedValue({ ok: true, error: null });
  await expect(add()).resolves.toMatchObject({ id: "created" });
  expect(joinSlackConversation).toHaveBeenCalledWith({
    token: "xoxb-token",
    channelId: "C1",
  });
});
it("requires an invitation for private channels", async () => {
  vi.mocked(getSlackConversation).mockResolvedValue({
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
  vi.mocked(getSlackConversation).mockResolvedValue(null);
  await expect(add()).rejects.toThrow("Slack channel not found");
  expect(createEventWebHook).not.toHaveBeenCalled();
});
