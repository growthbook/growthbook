import type { JsonPatchOperation } from "shared/enterprise";
import { deriveChange } from "back-end/src/services/savedGroupRevisionEvents";

const replace = (path: string): JsonPatchOperation => ({
  op: "replace",
  path,
  value: "x",
});

describe("deriveChange", () => {
  it("maps a condition change", () => {
    expect(deriveChange([replace("/condition")])).toBe("condition");
  });

  it("maps a values change", () => {
    expect(deriveChange([replace("/values")])).toBe("values");
  });

  it("maps an archived change to 'archive'", () => {
    expect(deriveChange([replace("/archived")])).toBe("archive");
  });

  it("maps metadata fields (name/owner/description/projects) to 'metadata'", () => {
    expect(deriveChange([replace("/groupName")])).toBe("metadata");
    expect(deriveChange([replace("/owner")])).toBe("metadata");
    expect(deriveChange([replace("/description")])).toBe("metadata");
    expect(deriveChange([replace("/projects")])).toBe("metadata");
  });

  it("defaults to 'metadata' for empty proposed changes", () => {
    expect(deriveChange([])).toBe("metadata");
  });

  it("prefers condition over values when both are present", () => {
    expect(deriveChange([replace("/values"), replace("/condition")])).toBe(
      "condition",
    );
  });

  it("prefers values over archive when both are present", () => {
    expect(deriveChange([replace("/archived"), replace("/values")])).toBe(
      "values",
    );
  });
});
