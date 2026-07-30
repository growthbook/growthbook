import { OrganizationInterface } from "shared/types/organization";
import {
  getAccountPlan,
  getLicense,
  licenseInit,
} from "back-end/src/enterprise";
import {
  findOrganizationById,
  findOrganizationByInviteKey,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import {
  acceptInvite,
  addMemberToOrg,
  inviteUser,
} from "back-end/src/services/organizations";

jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  getAccountPlan: jest.fn(),
  getLicense: jest.fn(),
  licenseInit: jest.fn(),
}));

jest.mock("back-end/src/models/OrganizationModel", () => ({
  createOrganization: jest.fn(),
  findAllOrganizations: jest.fn(),
  findOrganizationById: jest.fn(),
  findOrganizationByInviteKey: jest.fn(),
  findOrganizationsByDomain: jest.fn(),
  updateOrganization: jest.fn(),
}));

jest.mock("back-end/src/services/email", () => ({
  isEmailEnabled: jest.fn(() => false),
  sendInviteEmail: jest.fn(),
  sendNewMemberEmail: jest.fn(),
  sendPendingMemberEmail: jest.fn(),
}));

jest.mock("back-end/src/services/plan-limits", () => ({
  getEffectiveOrgLimits: jest.fn(() => ({
    orgSupportsRoles: () => true,
  })),
}));

jest.mock("back-end/src/util/secrets", () => ({
  ...jest.requireActual("back-end/src/util/secrets"),
  IS_CLOUD: true,
}));

const mockedGetAccountPlan = jest.mocked(getAccountPlan);
const mockedGetLicense = jest.mocked(getLicense);
const mockedLicenseInit = jest.mocked(licenseInit);
const mockedFindOrganizationByInviteKey = jest.mocked(
  findOrganizationByInviteKey,
);
const mockedFindOrganizationById = jest.mocked(findOrganizationById);
const mockedUpdateOrganization = jest.mocked(updateOrganization);

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

function makeMembers(count: number): OrganizationInterface["members"] {
  return Array.from({ length: count }, (_, index) => ({
    id: `user_${index}`,
    role: "admin",
    limitAccessByEnvironment: false,
    environments: [],
    dateCreated: new Date(),
  }));
}

function makeInvite(email = "invited@example.com") {
  return {
    email,
    key: "invite_key",
    role: "admin",
    limitAccessByEnvironment: false,
    environments: [],
    dateCreated: new Date(),
  };
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

function addMember(organization: OrganizationInterface, userId: string) {
  return addMemberToOrg({
    organization,
    userId,
    role: "admin",
    limitAccessByEnvironment: false,
    environments: [],
    projectRoles: [],
  });
}

describe("organization seat limits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetAccountPlan.mockReturnValue("enterprise");
    mockedGetLicense.mockReturnValue(null);
    mockedLicenseInit.mockResolvedValue(undefined);
    mockedUpdateOrganization.mockResolvedValue(undefined);
  });

  it("uses the organization license key and blocks new invites at a hard cap", async () => {
    const organization = makeOrganization({
      licenseKey: "license_key",
      members: makeMembers(2),
      invites: [makeInvite()],
    });
    mockedGetLicense.mockReturnValue({
      seats: 3,
      hardCap: true,
      plan: "enterprise",
    });

    await expect(
      sendInvite(organization, "another@example.com"),
    ).rejects.toThrow("You've reached the seat limit on your license.");

    expect(mockedGetLicense).toHaveBeenCalledWith("license_key");
    expect(mockedUpdateOrganization).not.toHaveBeenCalled();
  });

  it("allows new invites for enterprise licenses without a hard cap", async () => {
    const organization = makeOrganization({
      licenseKey: "license_key",
      members: makeMembers(3),
    });
    mockedGetLicense.mockReturnValue({
      seats: 3,
      hardCap: false,
      plan: "enterprise",
    });

    await sendInvite(organization, "another@example.com");

    expect(mockedUpdateOrganization).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({
        invites: expect.arrayContaining([
          expect.objectContaining({ email: "another@example.com" }),
        ]),
      }),
    );
  });

  it("blocks new invites that exceed a Cloud starter organization's free seats", async () => {
    const organization = makeOrganization({
      members: makeMembers(3),
    });
    mockedGetAccountPlan.mockReturnValue("starter");

    await expect(
      sendInvite(organization, "another@example.com"),
    ).rejects.toMatchObject({
      message:
        "You've reached the free seat limit. Upgrade your plan to add more team members.",
      status: 402,
    });

    expect(mockedUpdateOrganization).not.toHaveBeenCalled();
  });

  it("uses an organization's custom free-seat allowance", async () => {
    const organization = makeOrganization({
      freeSeats: 4,
      members: makeMembers(3),
    });
    mockedGetAccountPlan.mockReturnValue("starter");

    await sendInvite(organization, "another@example.com");

    expect(mockedUpdateOrganization).toHaveBeenCalled();
  });

  it("allows an existing invite at the hard cap without consuming another seat", async () => {
    const existingInvite = makeInvite();
    const organization = makeOrganization({
      licenseKey: "license_key",
      members: makeMembers(2),
      invites: [existingInvite],
    });
    mockedGetLicense.mockReturnValue({
      seats: 3,
      hardCap: true,
      plan: "enterprise",
    });

    await expect(
      sendInvite(organization, existingInvite.email),
    ).resolves.toMatchObject({
      emailSent: true,
    });

    expect(mockedGetLicense).not.toHaveBeenCalled();
    expect(mockedUpdateOrganization).not.toHaveBeenCalled();
  });

  it("blocks direct member additions at a hard cap", async () => {
    const organization = makeOrganization({
      licenseKey: "license_key",
      members: makeMembers(3),
    });
    mockedGetLicense.mockReturnValue({
      seats: 3,
      hardCap: true,
      plan: "enterprise",
    });

    await expect(addMember(organization, "new_user")).rejects.toThrow(
      "You've reached the seat limit on your license.",
    );

    expect(mockedUpdateOrganization).not.toHaveBeenCalled();
  });

  it("allows an existing member at the hard cap without consuming another seat", async () => {
    const organization = makeOrganization({
      licenseKey: "license_key",
      members: makeMembers(3),
    });
    mockedGetLicense.mockReturnValue({
      seats: 3,
      hardCap: true,
      plan: "enterprise",
    });

    await expect(addMember(organization, "user_0")).resolves.toBeUndefined();

    expect(mockedGetLicense).not.toHaveBeenCalled();
    expect(mockedUpdateOrganization).not.toHaveBeenCalled();
  });

  it("allows accepting an invite at the hard cap because seat usage is unchanged", async () => {
    const invite = makeInvite();
    const organization = makeOrganization({
      licenseKey: "license_key",
      members: makeMembers(2),
      invites: [invite],
    });
    const updatedOrganization = makeOrganization({
      ...organization,
      members: [
        ...organization.members,
        {
          id: "new_user",
          role: "admin",
          limitAccessByEnvironment: false,
          environments: [],
          dateCreated: new Date(),
        },
      ],
      invites: [],
    });
    mockedFindOrganizationByInviteKey.mockResolvedValue(organization);
    mockedFindOrganizationById.mockResolvedValue(updatedOrganization);

    await expect(
      acceptInvite(invite.key, "new_user", invite.email),
    ).resolves.toBe(updatedOrganization);

    expect(mockedUpdateOrganization).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({
        invites: [],
        members: expect.arrayContaining([
          expect.objectContaining({ id: "new_user" }),
        ]),
      }),
    );
    expect(mockedGetLicense).not.toHaveBeenCalled();
  });
});
