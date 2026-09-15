import { resolveSlackAssistantTarget } from "back-end/src/services/slack/slackIdentity";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";
import { SlackUserLinkModel } from "back-end/src/models/SlackUserLinkModel";
import type { ApiReqContext } from "back-end/types/api";

jest.mock("back-end/src/models/EventWebhookModel", () => ({
  EventWebHookModel: {
    find: () => ({
      lean: async () => [
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
      ],
    }),
  },
}));
jest.mock("back-end/src/models/OrganizationModel", () => ({
  findOrganizationById: async (id: string) => ({ id }),
}));
jest.mock("back-end/src/models/SlackUserLinkModel", () => ({
  SlackUserLinkModel: { dangerousFindBySlackIdentity: jest.fn() },
}));
jest.mock("back-end/src/services/organizations", () => ({
  getContextForUserIdInOrg: jest.fn(),
}));
jest.mock("back-end/src/util/slackToken", () => ({
  decryptSlackBotToken: () => "bot-token",
}));
jest.mock("back-end/src/util/mongo.util", () => ({
  getCollection: () => ({
    findOne: async () => ({
      encryptedBotAccessToken: "encrypted",
      assistantEnabled: true,
    }),
  }),
}));

const linked = {
  slackTeamId: "T1",
  slackUserId: "U1",
  growthbookUserId: "user1",
  organization: "org1",
  dateCreated: new Date(),
  dateUpdated: new Date(),
};
const context = { userId: "user1" } as ApiReqContext;
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(SlackUserLinkModel.dangerousFindBySlackIdentity)
    .mockResolvedValue(linked);
  jest.mocked(getContextForUserIdInOrg).mockResolvedValue(context);
});
it("uses a link created in one org in another connected org after checking membership", async () => {
  const target = await resolveSlackAssistantTarget({
    teamId: "T1",
    channelId: "C2",
    slackUserId: "U1",
  });
  expect(target).toMatchObject({
    ok: true,
    organizationId: "org2",
    userId: "user1",
    context,
  });
  expect(SlackUserLinkModel.dangerousFindBySlackIdentity).toHaveBeenCalledWith({
    slackTeamId: "T1",
    slackUserId: "U1",
  });
  expect(getContextForUserIdInOrg).toHaveBeenCalledWith(
    { id: "org2" },
    "user1",
  );
});
it("does not use the audit org to bypass revoked destination membership", async () => {
  jest.mocked(getContextForUserIdInOrg).mockResolvedValue(null);
  expect(
    await resolveSlackAssistantTarget({
      teamId: "T1",
      channelId: "C2",
      slackUserId: "U1",
    }),
  ).toMatchObject({ ok: false, reason: "not_a_member" });
});
it("refuses ambiguous DMs rather than using the link's audit organization", async () => {
  expect(
    await resolveSlackAssistantTarget({
      teamId: "T1",
      channelId: "D1",
      slackUserId: "U1",
    }),
  ).toMatchObject({ ok: false, reason: "ambiguous_org" });
});
