import {
  getDemoDatasourceProjectIdForOrganization,
  isDemoDatasourceProject,
} from "../../src/demo-datasource/demo-datasource.utils";

describe("demo datasource utils", () => {
  describe("getDemoDatasourceProjectIdForOrganization", () => {
    it("should return the demo ID", () => {
      expect(getDemoDatasourceProjectIdForOrganization("org-abc123")).toEqual(
        "prj_org-abc123_demo-datasource-project",
      );
      expect(
        getDemoDatasourceProjectIdForOrganization(
          "org-df887da3096649a89135a9019261d49c",
        ),
      ).toEqual(
        "prj_org-df887da3096649a89135a9019261d49c_demo-datasource-project",
      );
    });
  });

  describe("isDemoDatasourceProject", () => {
    it("should return true for the demo ID", () => {
      expect(
        isDemoDatasourceProject({
          projectId: "prj_org-myorganization_demo-datasource-project",
          organizationId: "org-myorganization",
        }),
      ).toBe(true);
      expect(
        isDemoDatasourceProject({
          projectId:
            "prj_org-f61af3bbfa5e442881d18562aa59ad29_demo-datasource-project",
          organizationId: "org-f61af3bbfa5e442881d18562aa59ad29",
        }),
      ).toBe(true);
    });

    it("should return false for another IDs", () => {
      expect(
        isDemoDatasourceProject({
          projectId: "prj_abc123",
          organizationId: "org-myorganization",
        }),
      ).toBe(false);
    });

    it("should return false for another organization's demo ID", () => {
      expect(
        isDemoDatasourceProject({
          projectId:
            "prj_org-f61af3bbfa5e442881d18562aa59ad29_demo-datasource-project",
          organizationId: "org-myorganization",
        }),
      ).toBe(false);
    });
  });
});
