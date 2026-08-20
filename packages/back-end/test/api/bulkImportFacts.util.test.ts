import { resolveFilterManagedBy } from "back-end/src/api/bulk-import/bulkImportFacts.util";

describe("resolveFilterManagedBy", () => {
  it("uses the per-resource value when set", () => {
    expect(resolveFilterManagedBy("", "api")).toBe("");
  });

  it("forces api when the parent Fact Table is api-managed", () => {
    expect(resolveFilterManagedBy(undefined, "api")).toBe("api");
  });

  it("leaves managedBy unset when the parent Fact Table is not api-managed", () => {
    expect(resolveFilterManagedBy(undefined, "")).toBeUndefined();
    expect(resolveFilterManagedBy(undefined, "admin")).toBeUndefined();
    expect(resolveFilterManagedBy(undefined, undefined)).toBeUndefined();
  });
});
