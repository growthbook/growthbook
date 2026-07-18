import {
  DEMO_FACT_TABLE_IDS,
  getDefaultProjectsForNewResource,
  getDemoDatasourceProjectIdForOrganization,
  getDemoResourceIds,
  getLegacyDemoFactTableIds,
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

  describe("DEMO_FACT_TABLE_IDS", () => {
    it("should use constant IDs without an org prefix", () => {
      expect(DEMO_FACT_TABLE_IDS).toEqual({
        purchases: "ftb_demo-purchases",
        pageViews: "ftb_demo-page-views",
      });
    });
  });

  describe("getLegacyDemoFactTableIds", () => {
    it("should return the previous org-prefixed fact table IDs", () => {
      expect(getLegacyDemoFactTableIds("org-abc123")).toEqual([
        "ftb_org-abc123_demo-datasource-project",
        "ftb_org-abc123_demo-datasource-page-views",
      ]);
    });
  });

  describe("getDefaultProjectsForNewResource", () => {
    it("should return the current project for normal projects", () => {
      expect(
        getDefaultProjectsForNewResource({
          project: "prj_abc",
          organizationId: "org-abc123",
        }),
      ).toEqual(["prj_abc"]);
    });

    it("should not seed the Sample Data project", () => {
      expect(
        getDefaultProjectsForNewResource({
          project: "prj_org-abc123_demo-datasource-project",
          organizationId: "org-abc123",
        }),
      ).toEqual([]);
    });

    it("should return empty when no project is selected", () => {
      expect(
        getDefaultProjectsForNewResource({
          organizationId: "org-abc123",
        }),
      ).toEqual([]);
    });
  });

  describe("getDemoResourceIds", () => {
    it("should return the full seeded-ID set", () => {
      expect(getDemoResourceIds("org-abc123")).toEqual({
        projectId: "prj_org-abc123_demo-datasource-project",
        datasourceId: "ds_demo-datasource-project",
        factTableIds: ["ftb_demo-purchases", "ftb_demo-page-views"],
        factMetricIds: [
          "fact__demo-revenue-per-user",
          "fact__demo-any-purchases",
          "fact__demo-d7-purchase-retention",
          "fact__demo-average-order-value",
        ],
        experimentId: "exp_demo-datasource-project",
        featureId: "gbdemo-checkout-layout",
      });
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
