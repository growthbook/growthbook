import {
  resolveSlackAssistantTarget,
  getSlackLinkConsent,
} from "back-end/src/services/slack/slackIdentity";
import { buildSlackLinkUrl } from "back-end/src/services/slack/slackLink";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { SlackUserLinkModel } from "back-end/src/models/SlackUserLinkModel";
import { SlackWorkspaceConnectionModel } from "back-end/src/models/SlackWorkspaceConnectionModel";
import type { ApiReqContext } from "back-end/types/api";

const webhooks = jest.fn();
jest.mock("back-end/src/models/EventWebhookModel", () => ({
  EventWebHookModel: { find: () => ({ lean: () => webhooks() }) },
}));
jest.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationById: async (id: string) => ({
    id,
    name: `Organization ${id}`,
  }),
}));
jest.mock("back-end/src/models/SlackUserLinkModel", () => ({
  SlackUserLinkModel: { dangerousFindAllBySlackIdentity: jest.fn() },
}));
jest.mock("back-end/src/models/SlackWorkspaceConnectionModel", () => ({
  SlackWorkspaceConnectionModel: { dangerousGetAllForTeam: jest.fn() },
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForUserIdInOrg: jest.fn(),
}));
jest.mock("back-end/src/util/slackToken", () => ({
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
const context = { userId: "user1" } as ApiReqContext;
const request = { teamId: "T1", channelId: "D1", slackUserId: "U1" };
beforeEach(() => {
  jest.clearAllMocks();
  webhooks.mockResolvedValue([
    {
      id: "wh1",
      organizationId: "org1",
      slack: { teamId: "T1", channelId: "C1" },
    },
    {
      id: "wh2",
      organizationId: "org2",
      slack: { teamId: "T1", channelId: "C2" },
    },
  ]);
  jest
    .mocked(SlackWorkspaceConnectionModel.dangerousGetAllForTeam)
    .mockResolvedValue(
      ["org1", "org2"].map((organization) => ({
        teamId: "T1",
        teamName: "Workspace",
        organization,
        encryptedBotAccessToken: `token_${organization}`,
        assistantEnabled: true,
        dateCreated: new Date(),
        dateUpdated: new Date(),
      })),
    );
  jest
    .mocked(SlackUserLinkModel.dangerousFindAllBySlackIdentity)
    .mockResolvedValue([linked("org1")]);
  jest.mocked(getContextForUserIdInOrg).mockResolvedValue(context);
});
it("does not reuse org A's link in org B even when the user is a member of both", async () => {
  expect(
    await resolveSlackAssistantTarget({ ...request, channelId: "C2" }),
  ).toMatchObject({ ok: false, reason: "not_linked" });
  expect(getContextForUserIdInOrg).not.toHaveBeenCalled();
});
it("automatically selects the only linked org in a workspace-only DM", async () => {
  webhooks.mockResolvedValue([]);
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: true,
    organizationId: "org1",
    botToken: "token_org1",
    eventWebHookId: null,
    linkId: "link_org1_user1",
  });
  expect(webhooks).not.toHaveBeenCalled();
});
it.each(["D1", "C_SHARED"])(
  "returns eligible per-org choices for ambiguous %s",
  async (channelId) => {
    jest
      .mocked(SlackUserLinkModel.dangerousFindAllBySlackIdentity)
      .mockResolvedValue([linked("org1"), linked("org2", "user2")]);
    webhooks.mockResolvedValue(
      ["org1", "org2"].map((organizationId) => ({
        id: organizationId,
        organizationId,
        slack: { channelId },
      })),
    );
    expect(
      await resolveSlackAssistantTarget({ ...request, channelId }),
    ).toMatchObject({
      ok: false,
      reason: "ambiguous_org",
      choices: [
        {
          organizationId: "org1",
          name: "Organization org1",
          linkId: "link_org1_user1",
        },
        {
          organizationId: "org2",
          name: "Organization org2",
          linkId: "link_org2_user2",
        },
      ],
      targets: [
        { organizationId: "org1", context },
        { organizationId: "org2", context },
      ],
    });
    expect(getContextForUserIdInOrg).toHaveBeenCalledWith(
      { id: "org2", name: "Organization org2" },
      "user2",
    );
  },
);
it("resolves the pinned org using that org's explicitly linked account", async () => {
  jest
    .mocked(SlackUserLinkModel.dangerousFindAllBySlackIdentity)
    .mockResolvedValue([linked("org1"), linked("org2", "user2")]);
  expect(
    await resolveSlackAssistantTarget({ ...request, organizationId: "org2" }),
  ).toMatchObject({
    ok: true,
    organizationId: "org2",
    userId: "user2",
    botToken: "token_org2",
  });
});
it("never reroutes a selected thread: an unlinked pinned org asks for a link, lost access is unavailable", async () => {
  const unlinked = await resolveSlackAssistantTarget({
    ...request,
    organizationId: "org2",
  });
  expect(unlinked).toMatchObject({ ok: false, reason: "not_linked" });
  if (unlinked.ok) throw new Error("Expected a failure");
  // The reader may not belong to the pinned organization, so it stays unnamed.
  expect(unlinked.message).not.toContain("org2");
  expect(unlinked.message).toContain("/integrations/slack/link?state=");
  jest.mocked(getContextForUserIdInOrg).mockResolvedValue(null);
  expect(
    await resolveSlackAssistantTarget({ ...request, organizationId: "org1" }),
  ).toMatchObject({ ok: false, reason: "organization_unavailable" });
});
it("counts every organization linked in the workspace, including for a pinned thread", async () => {
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: true,
    linkedOrganizationCount: 1,
  });
  jest
    .mocked(SlackUserLinkModel.dangerousFindAllBySlackIdentity)
    .mockResolvedValue([linked("org1"), linked("org2", "user2")]);
  expect(
    await resolveSlackAssistantTarget({ ...request, channelId: "C1" }),
  ).toMatchObject({
    ok: true,
    organizationId: "org1",
    linkedOrganizationCount: 2,
  });
  expect(
    await resolveSlackAssistantTarget({ ...request, organizationId: "org2" }),
  ).toMatchObject({
    ok: true,
    organizationId: "org2",
    linkedOrganizationCount: 2,
  });
});
it("checks revoked membership even for an unambiguous channel", async () => {
  jest.mocked(getContextForUserIdInOrg).mockResolvedValue(null);
  expect(
    await resolveSlackAssistantTarget({ ...request, channelId: "C1" }),
  ).toMatchObject({ ok: false, reason: "not_a_member" });
});
it("restricts consent choices to connected organizations the signed-in user belongs to", async () => {
  jest
    .mocked(getContextForUserIdInOrg)
    .mockImplementation(async (org) => (org.id === "org2" ? context : null));
  const state =
    new URL(
      buildSlackLinkUrl({ slackTeamId: "T1", slackUserId: "U1" }),
    ).searchParams.get("state") || "";
  expect(await getSlackLinkConsent(context, state)).toMatchObject({
    slackUserId: "U1",
    teamName: "Workspace",
    organizations: [{ id: "org2", linkedAccount: null }],
  });
});
it("offers only enabled assistant organizations and never switches a disabled pinned org", async () => {
  const connections =
    await SlackWorkspaceConnectionModel.dangerousGetAllForTeam("T1");
  connections[0].assistantEnabled = false;
  jest
    .mocked(SlackWorkspaceConnectionModel.dangerousGetAllForTeam)
    .mockResolvedValue(connections);
  jest
    .mocked(SlackUserLinkModel.dangerousFindAllBySlackIdentity)
    .mockResolvedValue([linked("org1"), linked("org2")]);
  const assistantRequest = { ...request, requireAssistantEnabled: true };
  expect(await resolveSlackAssistantTarget(assistantRequest)).toMatchObject({
    ok: true,
    organizationId: "org2",
  });
  expect(
    await resolveSlackAssistantTarget({
      ...assistantRequest,
      organizationId: "org1",
    }),
  ).toMatchObject({
    ok: true,
    organizationId: "org1",
    assistantEnabled: false,
  });
  // Recovery lookups can still find disabled assistants.
  expect(await resolveSlackAssistantTarget(request)).toMatchObject({
    ok: false,
    reason: "ambiguous_org",
  });
  connections[1].assistantEnabled = false;
  expect(await resolveSlackAssistantTarget(assistantRequest)).toMatchObject({
    ok: false,
    reason: "assistant_disabled",
  });
});
