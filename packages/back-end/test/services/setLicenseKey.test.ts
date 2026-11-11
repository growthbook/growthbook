import { OrganizationInterface } from "shared/types/organization";
import { licenseInit } from "back-end/src/enterprise";
import { setLicenseKey } from "back-end/src/services/organizations";

jest.mock("back-end/src/enterprise", () => ({
  ...jest.requireActual("back-end/src/enterprise"),
  licenseInit: jest.fn(),
}));

const mockedLicenseInit = jest.mocked(licenseInit);

function makeOrganization(): OrganizationInterface {
  return {
    id: "org_1",
    licenseKey: "license_old",
  } as OrganizationInterface;
}

describe("setLicenseKey", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects a key issued to another organization and keeps the old key", async () => {
    mockedLicenseInit.mockResolvedValue({ organizationId: "org_2" });
    const org = makeOrganization();

    await expect(setLicenseKey(org, "license_new")).rejects.toThrow(
      "This license key belongs to a different organization",
    );
    expect(org.licenseKey).toBe("license_old");
  });

  it("assigns a key issued to this organization", async () => {
    mockedLicenseInit.mockResolvedValue({ organizationId: "org_1" });
    const org = makeOrganization();

    await setLicenseKey(org, "license_new");

    expect(org.licenseKey).toBe("license_new");
    expect(mockedLicenseInit.mock.calls[0][0]).toMatchObject({
      id: "org_1",
      licenseKey: "license_new",
    });
  });

  it("assigns a key whose license has no organization", async () => {
    mockedLicenseInit.mockResolvedValue({});
    const org = makeOrganization();

    await setLicenseKey(org, "license_new");

    expect(org.licenseKey).toBe("license_new");
  });
});
