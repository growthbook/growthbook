import { generalAgentConfig } from "back-end/src/agent/general-agent";
import { ReqContextClass } from "back-end/src/services/context";
import { LocalConversationBuffer } from "back-end/src/enterprise/services/conversation-buffer";
import { slackAgentConfig } from "back-end/src/services/slack/slackAgent";

jest.mock("back-end/src/api/api.router", () => ({ allRoutes: [] }));
jest.mock("back-end/src/services/context");
jest.mock("back-end/src/enterprise/services/agent-handler", () => ({
  createAgentHandler: () => async () => undefined,
}));
jest.mock("back-end/src/enterprise/services/ai", () => ({
  aiTool: (definition: unknown) => definition,
}));

const context = new ReqContextClass({
  org: {
    id: "org1",
    name: "Organization",
    url: "",
    ownerEmail: "owner@example.com",
    dateCreated: new Date(),
    members: [],
    invites: [],
    settings: {},
  },
  auditUser: { type: "api_key", apiKey: "test" },
  role: "admin",
});

function conversation() {
  return new LocalConversationBuffer("conv_slack", {
    messages: [],
    isStreaming: false,
    lastStreamedAt: 0,
    title: "Slack conversation",
    agentType: "slack",
  });
}

it("omits web-only question controls without removing them from the web agent", () => {
  const buffer = conversation();
  const tools = slackAgentConfig.buildTools(context, buffer, {});
  expect(Object.keys(tools).sort()).toEqual(["callApi", "loadSkill", "wait"]);
  expect(generalAgentConfig.buildTools(context, buffer, {})).toHaveProperty(
    "askUser",
  );
});

it("still parks Slack mutations for explicit confirmation", async () => {
  const buffer = conversation();
  const emit = jest.fn();
  const tools = slackAgentConfig.buildTools(context, buffer, {}, emit);
  if (!tools.callApi.execute) throw new Error("Missing callApi implementation");
  await tools.callApi.execute(
    {
      method: "POST",
      path: "/api/v1/features",
      body: { id: "checkout" },
      summary: "Create the checkout Feature Flag",
    },
    { toolCallId: "call1", messages: [] },
  );
  expect(buffer.getPendingAction()).toMatchObject({
    method: "POST",
    path: "/api/v1/features",
    body: { id: "checkout" },
  });
  expect(emit).toHaveBeenCalledWith("confirm-action", expect.anything());
});
