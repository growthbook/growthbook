import { vi } from "vitest";
import type { OrganizationInterface } from "shared/types/organization";
import { AI_PROVIDERS } from "shared/ai";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import { assertAIEnabled } from "back-end/src/enterprise/services/ai-access";
import { getUserById } from "back-end/src/models/UserModel";
import { TeamModel } from "back-end/src/models/TeamModel";
import { ProjectModel } from "back-end/src/models/ProjectModel";
import { getResolvedAIKeys } from "back-end/src/services/aiCredentials";
import { getContextForUserIdInOrg } from "back-end/src/services/organizations";

vi.mock("back-end/src/enterprise", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/enterprise")>(
    "back-end/src/enterprise",
  )),
  orgHasPremiumFeature: vi.fn(),
}));
vi.mock("back-end/src/services/aiCredentials", async () => ({
  ...(await vi.importActual<
    typeof import("back-end/src/services/aiCredentials")
  >("back-end/src/services/aiCredentials")),
  getResolvedAIKeys: vi.fn(),
}));
vi.mock("back-end/src/models/UserModel", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/models/UserModel")>(
    "back-end/src/models/UserModel",
  )),
  getUserById: vi.fn(),
}));
vi.mock("back-end/src/util/secrets", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/util/secrets")>(
    "back-end/src/util/secrets",
  )),
  IS_CLOUD: false,
}));
// Passed to vi.fn() rather than mockImplementation() so restoreAllMocks keeps it.
vi.mock("back-end/src/services/context", () => ({
  ReqContextClass: vi.fn(function ({ org }: { org: OrganizationInterface }) {
    return { org };
  }),
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
  vi.clearAllMocks();
  vi.mocked(orgHasPremiumFeature).mockReturnValue(true);
  vi.mocked(getResolvedAIKeys).mockResolvedValue({
    openai: { key: "", source: "none" },
    anthropic: { key: "", source: "none" },
    google: { key: "", source: "none" },
    xai: { key: "", source: "none" },
    mistral: { key: "", source: "none" },
  });
  vi.mocked(getUserById).mockResolvedValue({
    id: "user_1",
    email: "owner@example.com",
    verified: true,
    superAdmin: false,
  });
  vi.spyOn(TeamModel, "dangerousGetTeamsForOrganization").mockResolvedValue([]);
  vi.spyOn(ProjectModel, "dangerousGetRestrictedProjectIds").mockResolvedValue(
    [],
  );
});

afterEach(() => vi.restoreAllMocks());

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
  vi.mocked(orgHasPremiumFeature).mockReturnValue(false);
  await expect(assertAIEnabled(await getContext())).rejects.toMatchObject({
    status: 403,
    message: "Your plan does not support AI features.",
  });
});
