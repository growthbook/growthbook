import { selectCandidateWorkspaces } from "back-end/src/services/slack/slackIdentity";

const connections = [{ organization: "org1" }, { organization: "org2" }];
const webhooks = [
  { id: "wh1", organizationId: "org1", slack: { channelId: "C_ONE" } },
  { id: "wh2", organizationId: "org2", slack: { channelId: "C_TWO" } },
];
it("uses exact channel bindings", () => {
  expect(selectCandidateWorkspaces(connections, webhooks, "C_TWO")).toEqual([
    { connection: connections[1], eventWebHookId: "wh2" },
  ]);
});
it.each(["C_OTHER", "G_PRIVATE", "G_GROUPDM", "", "U_USER", "D_INVALID"])(
  "rejects unbound conversation %s",
  (channel) => {
    expect(selectCandidateWorkspaces(connections, webhooks, channel)).toEqual(
      [],
    );
  },
);
it("routes real DMs from workspace connections even with no channels", () => {
  expect(selectCandidateWorkspaces(connections, [], "D123")).toEqual(
    connections.map((connection) => ({ connection, eventWebHookId: null })),
  );
});
it("does not treat a leftover channel subscription as a workspace connection", () => {
  expect(selectCandidateWorkspaces([], webhooks, "C_ONE")).toEqual([]);
});
it("keeps the exact channel webhook when one org has multiple subscriptions", () => {
  expect(
    selectCandidateWorkspaces(
      connections,
      [
        webhooks[0],
        { id: "wh3", organizationId: "org1", slack: { channelId: "C_THREE" } },
      ],
      "C_THREE",
    ),
  ).toEqual([{ connection: connections[0], eventWebHookId: "wh3" }]);
});
