import { useSettings } from "../../src/services/settings";
import {
  OrganizationInterface,
  OrganizationSettings,
} from "../../types/organization";
import { ProjectInterface } from "../../types/project";

const baseOrganization: OrganizationInterface = {
  dateCreated: new Date("2020-01-01"),
  id: "1",
  invites: [],
  members: [],
  name: "Test Org",
  ownerEmail: "",
  url: "test-org",
};

const mockProject: ProjectInterface = {
  id: "1",
  name: "Test Project",
  organization: "1",
  dateCreated: new Date("2020-01-01"),
  dateUpdated: new Date("2020-01-01"),
};

const genOrgWithSettings = (settings: Partial<OrganizationSettings>) => ({
  ...baseOrganization,
  settings,
});

describe("settings", () => {
  describe("useSettings fn", () => {
    it("returns org settings if no scopes are applied", () => {
      const settings = { pValueThreshold: 0.001 };
      const organization = genOrgWithSettings(settings);

      const { settings: newSettings } = useSettings(organization.settings);

      expect(newSettings.pValueThreshold.value).toEqual(
        settings.pValueThreshold
      );
    });

    it('applies project settings if "project" scope is applied', () => {
      const settings = { pValueThreshold: 0.001 };
      const organization = genOrgWithSettings(settings);

      const projectWithPValueOverride = {
        ...mockProject,
        pValueThreshold: 0.06,
      };

      const { settings: newSettings } = useSettings(organization.settings, {
        project: projectWithPValueOverride,
      });

      expect(newSettings.pValueThreshold.value).toEqual(
        projectWithPValueOverride.pValueThreshold
      );
    });
  });
});
