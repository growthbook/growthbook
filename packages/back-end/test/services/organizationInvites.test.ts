import { vi } from "vitest";
import { OrganizationInterface } from "shared/types/organization";
import {
  getAccountPlan,
  getLicense,
  licenseInit,
} from "back-end/src/enterprise";
import { addOrganizationInviteIfSeatAvailable } from "back-end/src/models/OrganizationModel";
import { inviteUser } from "back-end/src/services/organizations";

vi.mock("back-end/src/enterprise", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/enterprise")>(
    "back-end/src/enterprise",
  )),
  getAccountPlan: vi.fn(),
  getLicense: vi.fn(),
  licenseInit: vi.fn(),
}));

vi.mock("back-end/src/models/OrganizationModel", () => ({
  acceptOrganizationInvite: vi.fn(),
  addOrganizationInviteIfSeatAvailable: vi.fn(),
  addOrganizationMemberIfSeatAvailable: vi.fn(),
  createOrganization: vi.fn(),
  findAllOrganizations: vi.fn(),
  findOrganizationById: vi.fn(),
  findOrganizationByInviteKey: vi.fn(),
  findOrganizationsByDomain: vi.fn(),
  updateOrganization: vi.fn(),
}));

vi.mock("back-end/src/services/email", () => ({
  isEmailEnabled: vi.fn(() => false),
  sendInviteEmail: vi.fn(),
  sendNewMemberEmail: vi.fn(),
  sendPendingMemberEmail: vi.fn(),
}));

vi.mock("back-end/src/services/plan-limits", () => ({
  getEffectiveOrgLimits: vi.fn(() => ({
    orgSupportsRoles: () => true,
  })),
}));

vi.mock("back-end/src/util/secrets", async () => ({
  ...(await vi.importActual<typeof import("back-end/src/util/secrets")>(
    "back-end/src/util/secrets",
  )),
  IS_CLOUD: true,
}));

const mockedGetAccountPlan = vi.mocked(getAccountPlan);
const mockedGetLicense = vi.mocked(getLicense);
const mockedLicenseInit = vi.mocked(licenseInit);
const mockedAddOrganizationInviteIfSeatAvailable = vi.mocked(
  addOrganizationInviteIfSeatAvailable,
);

function makeOrganization(
  overrides: Partial<OrganizationInterface> = {},
): OrganizationInterface {
  return {
    id: "org_1",
    url: "acme",
    dateCreated: new Date(),
    name: "Acme",
    ownerEmail: "owner@example.com",
    members: [],
    invites: [],
    ...overrides,
  } as OrganizationInterface;
}

function sendInvite(organization: OrganizationInterface, email: string) {
  return inviteUser({
    organization,
    email,
    role: "admin",
    limitAccessByEnvironment: false,
    environments: [],
    projectRoles: [],
    invitedBy: "owner@example.com",
  });
}

describe("inviteUser email validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedGetAccountPlan.mockReturnValue("enterprise");
    mockedGetLicense.mockReturnValue(null);
    mockedLicenseInit.mockResolvedValue(undefined);
    mockedAddOrganizationInviteIfSeatAvailable.mockImplementation(
      async (id, invite) =>
        ({
          ...makeOrganization(),
          invites: [invite],
        }) as OrganizationInterface,
    );
  });

  it("strips a stray trailing semicolon before storing the invite", async () => {
    const organization = makeOrganization();

    await sendInvite(organization, "gsj@brolo.me;");

    expect(mockedAddOrganizationInviteIfSeatAvailable).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({ email: "gsj@brolo.me" }),
      null,
    );
  });

  it("strips leading and trailing separators and whitespace", async () => {
    const organization = makeOrganization();

    await sendInvite(organization, " ;User@Example.com,; ");

    expect(mockedAddOrganizationInviteIfSeatAvailable).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({ email: "user@example.com" }),
      null,
    );
  });

  it("rejects a clearly malformed email", async () => {
    const organization = makeOrganization();

    await expect(sendInvite(organization, "not-an-email")).rejects.toThrow(
      "Invalid email address: not-an-email",
    );

    expect(mockedAddOrganizationInviteIfSeatAvailable).not.toHaveBeenCalled();
  });

  it("rejects multiple addresses joined by a separator", async () => {
    const organization = makeOrganization();

    await expect(
      sendInvite(organization, "a@example.com;b@example.com"),
    ).rejects.toThrow("Invalid email address: a@example.com;b@example.com");

    expect(mockedAddOrganizationInviteIfSeatAvailable).not.toHaveBeenCalled();
  });

  it("trims whitespace and lowercases before storing the invite", async () => {
    const organization = makeOrganization();

    await sendInvite(organization, "  User@Example.com ");

    expect(mockedAddOrganizationInviteIfSeatAvailable).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({ email: "user@example.com" }),
      null,
    );
  });

  it("matches an existing invite after normalization", async () => {
    const organization = makeOrganization({
      invites: [
        {
          email: "invited@example.com",
          key: "invite_key",
          role: "admin",
          limitAccessByEnvironment: false,
          environments: [],
          dateCreated: new Date(),
        },
      ],
    });

    await expect(
      sendInvite(organization, " Invited@Example.com "),
    ).resolves.toMatchObject({ emailSent: true });

    expect(mockedAddOrganizationInviteIfSeatAvailable).not.toHaveBeenCalled();
  });
});
