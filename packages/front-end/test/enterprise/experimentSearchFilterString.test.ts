import {
  getAdvancedExperimentFilters,
  getExperimentCategoryValues,
  getExperimentSearchTerm,
  setExperimentCategoryValues,
  setExperimentSearchTerm,
} from "@/enterprise/components/Dashboards/DashboardEditor/experimentSearchFilterString";

describe("getExperimentCategoryValues", () => {
  it("returns an empty array when the search string is absent or unrelated", () => {
    expect(getExperimentCategoryValues(undefined, "tag")).toEqual([]);
    expect(getExperimentCategoryValues("", "tag")).toEqual([]);
    expect(getExperimentCategoryValues("status:running", "tag")).toEqual([]);
  });

  it("reads the values of a plain category filter", () => {
    expect(
      getExperimentCategoryValues("tag:checkout,pricing status:running", "tag"),
    ).toEqual(["checkout", "pricing"]);
  });

  it("ignores negated and operator filters for the same field", () => {
    expect(getExperimentCategoryValues("tag:!checkout", "tag")).toEqual([]);
    expect(getExperimentCategoryValues("tag:^checkout", "tag")).toEqual([]);
  });
});

describe("setExperimentCategoryValues", () => {
  it("adds a category to an empty search string", () => {
    expect(setExperimentCategoryValues(undefined, "status", ["running"])).toBe(
      "status:running",
    );
  });

  it("replaces only the target category", () => {
    const result = setExperimentCategoryValues(
      "tag:checkout status:running",
      "status",
      ["stopped"],
    );
    expect(getExperimentCategoryValues(result, "status")).toEqual(["stopped"]);
    expect(getExperimentCategoryValues(result, "tag")).toEqual(["checkout"]);
  });

  it("clears the category when passed no values", () => {
    const result = setExperimentCategoryValues(
      "tag:checkout status:running",
      "status",
      [],
    );
    expect(getExperimentCategoryValues(result, "status")).toEqual([]);
    expect(getExperimentCategoryValues(result, "tag")).toEqual(["checkout"]);
  });

  it("returns an empty string once the last filter is cleared", () => {
    expect(setExperimentCategoryValues("status:running", "status", [])).toBe(
      "",
    );
  });

  it("preserves the free-text term and advanced filters", () => {
    const result = setExperimentCategoryValues(
      "tag:!legacy status:>running checkout flow",
      "owner",
      ["ada"],
    );
    expect(getExperimentCategoryValues(result, "owner")).toEqual(["ada"]);
    expect(getExperimentSearchTerm(result)).toBe("checkout flow");
    expect(getAdvancedExperimentFilters(result)).toEqual([
      { field: "tag", values: ["legacy"], operator: "", negated: true },
      { field: "status", values: ["running"], operator: ">", negated: false },
    ]);
  });

  it("quotes values containing spaces so they round-trip", () => {
    const result = setExperimentCategoryValues(undefined, "owner", [
      "Ada Lovelace",
    ]);
    expect(result).toBe('owner:"Ada Lovelace"');
    expect(getExperimentCategoryValues(result, "owner")).toEqual([
      "Ada Lovelace",
    ]);
  });
});

describe("experiment search term", () => {
  it("reads the free-text portion only", () => {
    expect(getExperimentSearchTerm("tag:checkout holiday sale")).toBe(
      "holiday sale",
    );
    expect(getExperimentSearchTerm("tag:checkout")).toBe("");
    expect(getExperimentSearchTerm(undefined)).toBe("");
  });

  it("replaces the free-text portion while keeping filter tokens", () => {
    const result = setExperimentSearchTerm("tag:checkout holiday", "pricing");
    expect(getExperimentCategoryValues(result, "tag")).toEqual(["checkout"]);
    expect(getExperimentSearchTerm(result)).toBe("pricing");
  });

  it("clears the free-text portion", () => {
    expect(setExperimentSearchTerm("tag:checkout holiday", "")).toBe(
      "tag:checkout",
    );
  });
});
