import { useOrgSettings } from "../../src/services/orgSettings";
import { OrganizationInterface } from "../../types/organization";

const baseOrganization: OrganizationInterface = {
  dateCreated: new Date("2020-01-01"),
  id: "1",
  invites: [],
  members: [],
  name: "Test Org",
  ownerEmail: "",
  url: "test-org",
};

describe("orgSettings", () => {
  describe("useOrgSettings fn", () => {
    it("returns org settings if no scopes are applied", () => {
      const settings = { pValueThreshold: 0.001 };
      const organization: OrganizationInterface = {
        ...baseOrganization,
        settings,
      };
      const { settings: newSettings } = useOrgSettings(organization);
      expect(newSettings.pValueThreshold.value).toEqual(
        settings.pValueThreshold
      );
    });
  });
});
