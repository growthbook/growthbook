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
      title: " Create Feature Flag checkout ",
      summary: "Create the checkout Feature Flag",
    },
    { toolCallId: "call1", messages: [] },
  );
  expect(buffer.getPendingAction()).toMatchObject({
    method: "POST",
    path: "/api/v1/features",
    body: { id: "checkout" },
    title: "Create Feature Flag checkout",
  });
  expect(emit).toHaveBeenCalledWith("confirm-action", expect.anything());
});

it("uses Slack guidance without web page context or question controls", async () => {
  const prompt = await slackAgentConfig.buildSystemPrompt(context, {});
  expect(prompt).toContain("# Talking in Slack");
  expect(prompt).toContain("# GrowthBook concepts");
  expect(prompt).not.toContain("# Page context");
  expect(prompt).not.toContain("askUser");
  expect(prompt).not.toContain("sidebar");
  expect(prompt).toContain(
    "Existing dashboards cannot be updated or deleted from Slack",
  );
  expect(slackAgentConfig.injectDatasourceHint).toBe(false);
  expect(generalAgentConfig.injectDatasourceHint).toBe(true);
});

it("refuses existing dashboard writes from Slack before requesting confirmation", async () => {
  const buffer = conversation();
  const emit = jest.fn();
  const tools = slackAgentConfig.buildTools(context, buffer, {}, emit);
  if (!tools.callApi.execute) throw new Error("Missing callApi implementation");
  const result = await tools.callApi.execute(
    {
      method: "PUT",
      path: "/api/v1/dashboards/dash_123",
      body: { title: "Updated" },
    },
    { toolCallId: "call1", messages: [] },
  );
  expect(result).toMatchObject({ status: "rejected" });
  expect(buffer.getPendingAction()).toBeUndefined();
  expect(emit).not.toHaveBeenCalled();
});
