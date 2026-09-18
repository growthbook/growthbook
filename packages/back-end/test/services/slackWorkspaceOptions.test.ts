import { setSlackAssistantEnabled } from "back-end/src/services/slackIntegration";
import type { ReqContext } from "back-end/types/request";

const connection = { organization: "org-1", teamId: "T1" };
const update = jest.fn();
const getAll = jest.fn();
const context = {
  models: { slackWorkspaceConnections: { getAll, update } },
} as unknown as ReqContext;

beforeEach(() => {
  jest.clearAllMocks();
  getAll.mockResolvedValue([connection]);
});

it("updates through the organization-scoped model, preserving its permission checks", async () => {
  await setSlackAssistantEnabled({
    context,
    teamId: "T1",
    enabled: true,
  });
  expect(update).toHaveBeenCalledWith(connection, { assistantEnabled: true });
});
it("rejects a workspace that is not in the current organization", async () => {
  await expect(
    setSlackAssistantEnabled({
      context,
      teamId: "T_OTHER",
      enabled: true,
    }),
  ).rejects.toThrow();
  expect(update).not.toHaveBeenCalled();
});
it("does not guess when the organization has multiple workspaces", async () => {
  getAll.mockResolvedValue([
    connection,
    { organization: "org-1", teamId: "T2" },
  ]);
  await expect(
    setSlackAssistantEnabled({
      context,
      enabled: true,
    }),
  ).rejects.toThrow("Multiple Slack workspaces");
  expect(update).not.toHaveBeenCalled();
});
