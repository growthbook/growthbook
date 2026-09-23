import type { OrganizationInterface } from "shared/types/organization";
import { AI_PROVIDERS } from "shared/ai";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { assertAIEnabled } from "back-end/src/enterprise/services/ai-access";
import { getUserById } from "back-end/src/models/UserModel";
import { TeamModel } from "back-end/src/models/TeamModel";
import { ProjectModel } from "back-end/src/models/ProjectModel";
import { getResolvedAIKeys } from "back-end/src/services/aiCredentials";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";

jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  orgHasPremiumFeature: jest.fn(),
}));
jest.mock("back-end/src/services/aiCredentials", () => ({
  ...jest.requireActual("back-end/src/services/aiCredentials"),
  getResolvedAIKeys: jest.fn(),
}));
jest.mock("back-end/src/models/UserModel", () => ({
  ...jest.requireActual("back-end/src/models/UserModel"),
  getUserById: jest.fn(),
}));
jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  IS_CLOUD: false,
}));
jest.mock("back-end/src/services/context", () => ({
  ReqContextClass: jest
    .fn()
    .mockImplementation(({ org }: { org: OrganizationInterface }) => ({ org })),
}));

const org: OrganizationInterface = {
  id: "org_1",
  url: "acme",
  name: "Acme",
  ownerEmail: "owner@example.com",
  dateCreated: new Date(),
  licenseKey: "license_1",
  members: [{ id: "user_1", role: "admin" }],
  invites: [],
  settings: { aiEnabled: true },
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(orgHasPremiumFeature).mockReturnValue(true);
  jest.mocked(getResolvedAIKeys).mockResolvedValue({
    openai: { key: "", source: "none" },
    anthropic: { key: "", source: "none" },
    google: { key: "", source: "none" },
    xai: { key: "", source: "none" },
    mistral: { key: "", source: "none" },
  });
  jest.mocked(getUserById).mockResolvedValue({
    id: "user_1",
    email: "owner@example.com",
    verified: true,
    superAdmin: false,
  });
  jest
    .spyOn(TeamModel, "dangerousGetTeamsForOrganization")
    .mockResolvedValue([]);
  jest
    .spyOn(ProjectModel, "dangerousGetRestrictedProjectIds")
    .mockResolvedValue([]);
});

afterEach(() => jest.restoreAllMocks());

async function getContext(organization = org) {
  const context = await getContextForUserIdInOrg(organization, "user_1");
  if (!context) throw new Error("Expected a linked user's context");
  return context;
}

it("rejects non-members", async () => {
  expect(
    await getContextForUserIdInOrg({ ...org, members: [] }, "user_1"),
  ).toBeNull();
  expect(getUserById).toHaveBeenCalledWith("user_1");
});

it("explains a missing provider key when the AI setting is already enabled", async () => {
  await expect(assertAIEnabled(await getContext())).rejects.toMatchObject({
    status: 404,
    message:
      "AI is enabled, but no usable AI provider API key is configured. An admin can add one in GrowthBook → Settings → AI & Prompts.",
  });
});

it("directs disabled organizations to the AI toggle", async () => {
  await expect(
    assertAIEnabled(
      await getContext({ ...org, settings: { aiEnabled: false } }),
    ),
  ).rejects.toMatchObject({
    status: 404,
    message:
      "AI is disabled for this organization. An admin can enable AI in GrowthBook → Settings → General.",
  });
});

it.each(AI_PROVIDERS)(
  "allows enabled AI with a usable %s key",
  async (provider) => {
    const context = await getContext();
    const keys = await getResolvedAIKeys(context);
    keys[provider] = { key: "test-provider-key", source: "organization" };
    await expect(assertAIEnabled(context)).resolves.toBeUndefined();
  },
);

it("preserves the plan failure when AI is configured", async () => {
  jest.mocked(orgHasPremiumFeature).mockReturnValue(false);
  await expect(assertAIEnabled(await getContext())).rejects.toMatchObject({
    status: 403,
    message: "Your plan does not support AI features.",
  });
});
