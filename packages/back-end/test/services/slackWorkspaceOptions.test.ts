import type { SlackWorkspaceConnectionInterface } from "shared/validators";
import {
  pickSlackWorkspaceConnection,
  setSlackAssistantEnabled,
} from "back-end/src/services/slackIntegration";
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

describe("pickSlackWorkspaceConnection", () => {
  const asConnections = (...items: { teamId: string }[]) =>
    items as SlackWorkspaceConnectionInterface[];
  const t1 = { teamId: "T1" };
  const t2 = { teamId: "T2" };

  it("returns the named workspace", () => {
    expect(pickSlackWorkspaceConnection(asConnections(t1, t2), "T2")).toBe(t2);
  });

  it("implies the only connected workspace when none is named", () => {
    expect(pickSlackWorkspaceConnection(asConnections(t1))).toBe(t1);
  });

  it("refuses to guess between several unnamed workspaces", () => {
    expect(() => pickSlackWorkspaceConnection(asConnections(t1, t2))).toThrow(
      "Multiple Slack workspaces are connected",
    );
  });

  it("reports a missing connection when the named workspace is absent", () => {
    expect(() =>
      pickSlackWorkspaceConnection(asConnections(t1, t2), "T3"),
    ).toThrow("No Slack workspace connection found");
  });

  it("reports a missing connection when nothing is connected", () => {
    expect(() => pickSlackWorkspaceConnection(asConnections())).toThrow(
      "No Slack workspace connection found",
    );
  });
});
