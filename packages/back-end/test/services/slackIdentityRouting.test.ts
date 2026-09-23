import { vi } from "vitest";
import {
  resolveSlackAssistantTarget,
  getSlackLinkConsent,
} from "back-end/src/services/slack/slackIdentity";
import { buildSlackLinkUrl } from "back-end/src/services/slack/slackLink";
import { licenseInit } from "back-end/src/enterprise";
import {
  getLicenseMetaData,
  getUserCodesForOrg,
} from "back-end/src/services/licenseData";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { SlackUserLinkModel } from "back-end/src/models/SlackUserLinkModel";
import { SlackWorkspaceConnectionModel } from "back-end/src/models/SlackWorkspaceConnectionModel";
import type { ApiReqContext } from "back-end/types/api";

const webhooks = vi.fn();
vi.mock("back-end/src/models/EventWebhookModel", () => ({
  EventWebHookModel: { find: () => ({ lean: () => webhooks() }) },
}));
vi.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationById: async (id: string) => ({
    id,
    name: `Organization ${id}`,
  }),
}));
vi.mock("back-end/src/models/SlackUserLinkModel", () => ({
  SlackUserLinkModel: { dangerousFindAllBySlackIdentity: vi.fn() },
}));
vi.mock("back-end/src/models/SlackWorkspaceConnectionModel", () => ({
  SlackWorkspaceConnectionModel: { dangerousGetForTeam: vi.fn() },
}));
vi.mock("back-end/src/services/organizations", () => ({
  getContextForUserIdInOrg: vi.fn(),
}));
vi.mock("back-end/src/enterprise", () => ({ licenseInit: vi.fn() }));
vi.mock("back-end/src/util/slackToken", () => ({
  decryptSlackBotToken: (token: string) => token,
}));
const linked = (organization: string, growthbookUserId = "user1") => ({
  slackTeamId: "T1",
  slackUserId: "U1",
  growthbookUserId,
  organization,
  linkId: `link_${organization}_${growthbookUserId}`,
  dateCreated: new Date(),
  dateUpdated: new Date(),
});
const context = { userId: "user1", org: { id: "org1" } } as ApiReqContext;
const request = { teamId: "T1", slackUserId: "U1" };
const connection = {
  teamId: "T1",
  teamName: "Workspace",
  organization: "org1",
  encryptedBotAccessToken: "token_org1",
  assistantEnabled: true,
  dateCreated: new Date(),
  dateUpdated: new Date(),
};
beforeEach(() => {
  vi.clearAllMocks();
  webhooks.mockResolvedValue([]);
  vi.mocked(
    SlackWorkspaceConnectionModel.dangerousGetForTeam,
  ).mockResolvedValue(connection);
  vi.mocked(
    SlackUserLinkModel.dangerousFindAllBySlackIdentity,
  ).mockResolvedValue([linked("org1")]);
  vi.mocked(getContextForUserIdInOrg).mockResolvedValue(context);
  vi.mocked(licenseInit).mockResolvedValue(undefined);
});
it("resolves the workspace's organization without notification subscriptions", async () => {
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: true,
    organizationId: "org1",
    botToken: "token_org1",
    linkId: "link_org1_user1",
  });
  expect(webhooks).not.toHaveBeenCalled();
  expect(getContextForUserIdInOrg).toHaveBeenCalledWith(
    { id: "org1", name: "Organization org1" },
    "user1",
  );
});
it("asks unlinked users to link their account without requiring notification channels", async () => {
  vi.mocked(
    SlackUserLinkModel.dangerousFindAllBySlackIdentity,
  ).mockResolvedValue([]);
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: false,
    reason: "not_linked",
  });
  expect(getContextForUserIdInOrg).not.toHaveBeenCalled();
});
it("never uses a link belonging to a different organization", async () => {
  vi.mocked(
    SlackUserLinkModel.dangerousFindAllBySlackIdentity,
  ).mockResolvedValue([linked("org2")]);
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: false,
    reason: "not_linked",
  });
  expect(getContextForUserIdInOrg).not.toHaveBeenCalled();
});
it("uses only the workspace organization's account even if old links remain", async () => {
  vi.mocked(
    SlackUserLinkModel.dangerousFindAllBySlackIdentity,
  ).mockResolvedValue([linked("org2"), linked("org1", "user2")]);
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: true,
    organizationId: "org1",
    userId: "user2",
    linkId: "link_org1_user2",
  });
});
it("rechecks revoked membership", async () => {
  vi.mocked(getContextForUserIdInOrg).mockResolvedValue(null);
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: false,
    reason: "not_a_member",
  });
  expect(licenseInit).not.toHaveBeenCalled();
});
it("loads the organization license for the resolved context", async () => {
  await resolveSlackAssistantTarget(request);
  expect(licenseInit).toHaveBeenCalledWith(
    context.org,
    getUserCodesForOrg,
    getLicenseMetaData,
  );
});
it("tells the user when the organization license can't be loaded", async () => {
  vi.mocked(licenseInit).mockRejectedValue(
    new Error("License server unavailable"),
  );
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: false,
    reason: "license_unavailable",
    botToken: "token_org1",
  });
});
it("respects an explicit assistant opt-out", async () => {
  vi.mocked(
    SlackWorkspaceConnectionModel.dangerousGetForTeam,
  ).mockResolvedValue({ ...connection, assistantEnabled: false });
  expect(
    await resolveSlackAssistantTarget({
      ...request,
      requireAssistantEnabled: true,
    }),
  ).toMatchObject({ ok: false, reason: "assistant_disabled" });
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: true,
  });
});
it("inherits organization AI access when the workspace setting is unset", async () => {
  vi.mocked(
    SlackWorkspaceConnectionModel.dangerousGetForTeam,
  ).mockResolvedValue({ ...connection, assistantEnabled: undefined });
  expect(
    await resolveSlackAssistantTarget({
      ...request,
      requireAssistantEnabled: true,
    }),
  ).toMatchObject({ ok: true, organizationId: "org1" });
});
it("requires a connected workspace", async () => {
  vi.mocked(
    SlackWorkspaceConnectionModel.dangerousGetForTeam,
  ).mockResolvedValue(null);
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: false,
    reason: "no_connection",
  });
  expect(getContextForUserIdInOrg).not.toHaveBeenCalled();
});
it("requires a bot token", async () => {
  vi.mocked(
    SlackWorkspaceConnectionModel.dangerousGetForTeam,
  ).mockResolvedValue({ ...connection, encryptedBotAccessToken: "" });
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: false,
    reason: "no_bot_token",
  });
});
it.each([
  { linkedUser: "user1", linkedAccount: "current" },
  { linkedUser: "user2", linkedAccount: "other" },
  { linkedUser: null, linkedAccount: null },
])(
  "offers one organization with account status $linkedAccount",
  async ({ linkedUser, linkedAccount }) => {
    vi.mocked(
      SlackUserLinkModel.dangerousFindAllBySlackIdentity,
    ).mockResolvedValue([
      linked("org2"),
      ...(linkedUser ? [linked("org1", linkedUser)] : []),
    ]);
    const state =
      new URL(
        buildSlackLinkUrl({ slackTeamId: "T1", slackUserId: "U1" }),
      ).searchParams.get("state") || "";
    expect(await getSlackLinkConsent(context, state)).toEqual({
      slackTeamId: "T1",
      slackUserId: "U1",
      teamName: "Workspace",
      organization: { id: "org1", name: "Organization org1", linkedAccount },
    });
    vi.mocked(getContextForUserIdInOrg).mockResolvedValue(null);
    await expect(getSlackLinkConsent(context, state)).rejects.toThrow(
      "Your account no longer has access",
    );
  },
);

it("rejects consent when the selected organization differs from the workspace", async () => {
  vi.mocked(
    SlackWorkspaceConnectionModel.dangerousGetForTeam,
  ).mockResolvedValue({ ...connection, organization: "org2" });
  const state =
    new URL(
      buildSlackLinkUrl({ slackTeamId: "T1", slackUserId: "U1" }),
    ).searchParams.get("state") || "";
  await expect(getSlackLinkConsent(context, state)).rejects.toThrow(
    "Switch to the connected organization",
  );
  expect(getContextForUserIdInOrg).not.toHaveBeenCalled();
});
