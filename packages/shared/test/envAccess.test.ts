import { OrganizationInterface } from "shared/types/organization";
import { envScopeLabels } from "../src/permissions/envAccess";

const org = {
  settings: {
    environments: [
      { id: "production", description: "" },
      { id: "dev", description: "", projects: ["prj_clo"] },
      { id: "staging", description: "", projects: ["prj_brainzy"] },
    ],
  },
  customRoles: [
    {
      id: "qa_publisher",
      description: "",
      policies: ["ReadData", "FlagsPublish"],
    },
    {
      id: "qa_reviewer",
      description: "",
      policies: ["ReadData", "FlagsReview"],
    },
    {
      id: "qa_drafter",
      description: "",
      policies: ["ReadData", "FlagsEditDrafts"],
    },
  ],
} as unknown as Partial<OrganizationInterface>;

describe("envScopeLabels", () => {
  it("names what a role does in an environment, in a fixed order", () => {
    expect(envScopeLabels("qa_publisher", org)).toEqual(["publish"]);
    expect(envScopeLabels("qa_reviewer", org)).toEqual(["review"]);
  });

  it("is empty for a role with no environment-scoped authority", () => {
    expect(envScopeLabels("qa_drafter", org)).toEqual([]);
  });

  it("is empty for admins, who are not bound by environment limits", () => {
    expect(envScopeLabels("admin", org)).toEqual([]);
  });

  it("spells out env-scoped atoms that are not revision actions", () => {
    expect(envScopeLabels("engineer", org)).toContain("run experiments");
  });
});
