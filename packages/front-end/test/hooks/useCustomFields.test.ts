import { CustomField } from "shared/types/custom-fields";
import { filterCustomFieldsForSectionAndProject } from "@/hooks/useCustomFields";

const makeField = (overrides: Partial<CustomField>): CustomField => ({
  id: "cf_default",
  name: "Default Field",
  type: "text",
  required: false,
  section: "feature",
  dateCreated: new Date("2026-01-01"),
  dateUpdated: new Date("2026-01-01"),
  ...overrides,
});

describe("filterCustomFieldsForSectionAndProject", () => {
  it("returns only all-project fields when selected project is empty", () => {
    const globalField = makeField({ id: "cf_global" });
    const projectAField = makeField({
      id: "cf_proj_a",
      projects: ["proj_a"],
    });
    const projectBField = makeField({
      id: "cf_proj_b",
      projects: ["proj_b"],
    });
    const otherSectionField = makeField({
      id: "cf_exp",
      section: "experiment",
    });

    const result = filterCustomFieldsForSectionAndProject(
      [globalField, projectAField, projectBField, otherSectionField],
      "feature",
      "",
    );

    expect(result).toEqual([{ ...globalField, projects: [] }]);
  });

  it("returns all-project fields plus matching project-scoped fields", () => {
    const globalField = makeField({ id: "cf_global" });
    const projectAField = makeField({
      id: "cf_proj_a",
      projects: ["proj_a"],
    });
    const projectBField = makeField({
      id: "cf_proj_b",
      projects: ["proj_b"],
    });

    const result = filterCustomFieldsForSectionAndProject(
      [globalField, projectAField, projectBField],
      "feature",
      "proj_a",
    );

    expect(result).toEqual([
      { ...globalField, projects: [] },
      { ...projectAField, projects: ["proj_a"] },
    ]);
  });

  it("treats legacy blank project lists as all-project fields", () => {
    const legacyGlobalField = makeField({
      id: "cf_legacy_global",
      projects: [""],
    });
    const projectField = makeField({
      id: "cf_proj_a",
      projects: ["proj_a"],
    });

    const result = filterCustomFieldsForSectionAndProject(
      [legacyGlobalField, projectField],
      "feature",
      "",
    );

    expect(result).toEqual([{ ...legacyGlobalField, projects: [] }]);
  });
});
