import { vi } from "vitest";
import { OrganizationInterface } from "shared/types/organization";
import {
  getAccountPlan,
  getLicense,
  licenseInit,
} from "back-end/src/enterprise";
import {
  acceptOrganizationInvite,
  addOrganizationInviteIfSeatAvailable,
  addOrganizationMemberIfSeatAvailable,
  findOrganizationById,
  findOrganizationByInviteKey,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import {
  acceptInvite,
  addMemberToOrg,
  inviteUser,
} from "back-end/src/services/organizations";

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
const mockedAcceptOrganizationInvite = vi.mocked(acceptOrganizationInvite);
const mockedAddOrganizationInviteIfSeatAvailable = vi.mocked(
  addOrganizationInviteIfSeatAvailable,
);
const mockedAddOrganizationMemberIfSeatAvailable = vi.mocked(
  addOrganizationMemberIfSeatAvailable,
);
const mockedFindOrganizationByInviteKey = vi.mocked(
  findOrganizationByInviteKey,
);
const mockedFindOrganizationById = vi.mocked(findOrganizationById);
const mockedUpdateOrganization = vi.mocked(updateOrganization);

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
    vi.clearAllMocks();
    mockedGetAccountPlan.mockReturnValue("enterprise");
    mockedGetLicense.mockReturnValue(null);
    mockedLicenseInit.mockResolvedValue(undefined);
    mockedAcceptOrganizationInvite.mockResolvedValue(null);
    mockedAddOrganizationInviteIfSeatAvailable.mockResolvedValue(null);
    mockedAddOrganizationMemberIfSeatAvailable.mockResolvedValue(null);
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
    mockedFindOrganizationById.mockResolvedValue(organization);

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
    mockedAddOrganizationInviteIfSeatAvailable.mockResolvedValue({
      ...organization,
      invites: [makeInvite("another@example.com")],
    });

    await sendInvite(organization, "another@example.com");

    expect(mockedAddOrganizationInviteIfSeatAvailable).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({
        email: "another@example.com",
      }),
      null,
    );
  });

  it("blocks new invites that exceed a Cloud starter organization's free seats", async () => {
    const organization = makeOrganization({
      members: makeMembers(3),
    });
    mockedGetAccountPlan.mockReturnValue("starter");
    mockedFindOrganizationById.mockResolvedValue(organization);

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
    mockedAddOrganizationInviteIfSeatAvailable.mockResolvedValue({
      ...organization,
      invites: [makeInvite("another@example.com")],
    });

    await sendInvite(organization, "another@example.com");

    expect(mockedAddOrganizationInviteIfSeatAvailable).toHaveBeenCalledWith(
      organization.id,
      expect.objectContaining({ email: "another@example.com" }),
      4,
    );
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
    mockedFindOrganizationById.mockResolvedValue(organization);

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
    mockedAcceptOrganizationInvite.mockResolvedValue(updatedOrganization);

    await expect(
      acceptInvite(invite.key, "new_user", invite.email),
    ).resolves.toBe(updatedOrganization);

    expect(mockedAcceptOrganizationInvite).toHaveBeenCalledWith(
      organization.id,
      invite.key,
      expect.objectContaining({
        id: "new_user",
      }),
    );
    expect(mockedGetLicense).not.toHaveBeenCalled();
  });
});
