import { CustomField } from "shared/types/custom-fields";
import {
  customFieldValuesEqual,
  filterCustomFieldsForSectionAndProject,
  getSeededCustomFieldDefaultValue,
  normalizeCustomFieldValues,
  reconcileCustomFieldValues,
} from "@/services/customFields";

const makeField = (overrides: Partial<CustomField>): CustomField => ({
  id: "cf_default",
  name: "Default Field",
  type: "text",
  required: false,
  sections: ["feature"],
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
      sections: ["experiment"],
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

describe("normalizeCustomFieldValues", () => {
  it("parses legacy JSON string values", () => {
    expect(normalizeCustomFieldValues('{"cf_x":"y","cf_n":3}')).toEqual({
      cf_x: "y",
      cf_n: "3",
    });
  });

  it("returns an empty object for invalid JSON strings", () => {
    expect(normalizeCustomFieldValues("not json")).toEqual({});
  });

  it("returns an empty object for null / undefined", () => {
    expect(normalizeCustomFieldValues(null)).toEqual({});
    expect(normalizeCustomFieldValues(undefined)).toEqual({});
  });

  it("coerces booleans, numbers, and nullish per-key values to strings", () => {
    expect(
      normalizeCustomFieldValues({
        cf_bool: true,
        cf_bool_false: false,
        cf_num: 42,
        cf_null: null,
        cf_undefined: undefined,
        cf_str: "hello",
      }),
    ).toEqual({
      cf_bool: "true",
      cf_bool_false: "false",
      cf_num: "42",
      cf_null: "",
      cf_undefined: "",
      cf_str: "hello",
    });
  });
});

describe("getSeededCustomFieldDefaultValue", () => {
  it("returns undefined when no meaningful default is configured", () => {
    expect(
      getSeededCustomFieldDefaultValue(makeField({ type: "text" })),
    ).toBeUndefined();
    expect(
      getSeededCustomFieldDefaultValue(
        makeField({ type: "text", defaultValue: "" }),
      ),
    ).toBeUndefined();
    expect(
      getSeededCustomFieldDefaultValue(
        makeField({ type: "multiselect", defaultValue: [] }),
      ),
    ).toBeUndefined();
  });

  it("stringifies multiselect defaults as a JSON array", () => {
    expect(
      getSeededCustomFieldDefaultValue(
        makeField({ type: "multiselect", defaultValue: ["a", "b"] }),
      ),
    ).toBe(JSON.stringify(["a", "b"]));
    expect(
      getSeededCustomFieldDefaultValue(
        makeField({ type: "multiselect", defaultValue: "a" }),
      ),
    ).toBe(JSON.stringify(["a"]));
  });

  it("normalizes boolean defaults to true/false strings", () => {
    expect(
      getSeededCustomFieldDefaultValue(
        makeField({ type: "boolean", defaultValue: true }),
      ),
    ).toBe("true");
    expect(
      getSeededCustomFieldDefaultValue(
        makeField({ type: "boolean", defaultValue: "true" }),
      ),
    ).toBe("true");
    expect(
      getSeededCustomFieldDefaultValue(
        makeField({ type: "boolean", defaultValue: "anything-else" }),
      ),
    ).toBe("false");
  });

  it("stringifies scalar defaults", () => {
    expect(
      getSeededCustomFieldDefaultValue(
        makeField({ type: "number", defaultValue: 7 }),
      ),
    ).toBe("7");
  });
});

describe("reconcileCustomFieldValues", () => {
  it("returns an empty object when there are no available fields", () => {
    expect(reconcileCustomFieldValues(undefined, { cf_x: "y" })).toEqual({});
    expect(reconcileCustomFieldValues([], { cf_x: "y" })).toEqual({});
  });

  it("preserves user-set values including falsy-looking strings", () => {
    const boolField = makeField({ id: "cf_bool", type: "boolean" });
    const numField = makeField({ id: "cf_num", type: "number" });

    expect(
      reconcileCustomFieldValues([boolField, numField], {
        cf_bool: "false",
        cf_num: "0",
      }),
    ).toEqual({ cf_bool: "false", cf_num: "0" });
  });

  it("seeds an explicit false for booleans without a default", () => {
    const boolField = makeField({ id: "cf_bool", type: "boolean" });
    expect(reconcileCustomFieldValues([boolField], {})).toEqual({
      cf_bool: "false",
    });
  });

  it("seeds configured defaults only when the value is unset", () => {
    const field = makeField({
      id: "cf_text",
      type: "text",
      defaultValue: "seed",
    });
    expect(reconcileCustomFieldValues([field], {})).toEqual({
      cf_text: "seed",
    });
    expect(reconcileCustomFieldValues([field], { cf_text: "user" })).toEqual({
      cf_text: "user",
    });
  });

  it("omits optional non-boolean fields that have no entry and no default", () => {
    const field = makeField({ id: "cf_text", type: "text" });
    expect(reconcileCustomFieldValues([field], {})).toEqual({});
  });

  it("keeps an explicitly cleared value instead of re-seeding the default", () => {
    const field = makeField({
      id: "cf_text",
      type: "text",
      defaultValue: "seed",
    });
    expect(reconcileCustomFieldValues([field], { cf_text: "" })).toEqual({
      cf_text: "",
    });
  });

  it("drops keys for fields that no longer apply (project switch)", () => {
    const globalField = makeField({ id: "cf_global", type: "text" });

    expect(
      reconcileCustomFieldValues([globalField], {
        cf_global: "keep",
        cf_proj: "drop",
      }),
    ).toEqual({ cf_global: "keep" });
  });

  it("is idempotent", () => {
    const fields = [
      makeField({ id: "cf_bool", type: "boolean" }),
      makeField({ id: "cf_text", type: "text", defaultValue: "seed" }),
      makeField({ id: "cf_opt", type: "text" }),
    ];
    const once = reconcileCustomFieldValues(fields, {});
    const twice = reconcileCustomFieldValues(fields, once);
    expect(twice).toEqual(once);
  });
});

describe("customFieldValuesEqual", () => {
  it("returns true for maps with identical keys and values", () => {
    expect(customFieldValuesEqual({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(
      true,
    );
  });

  it("returns false when keys or values differ", () => {
    expect(customFieldValuesEqual({ a: "1" }, { a: "1", b: "2" })).toBe(false);
    expect(customFieldValuesEqual({ a: "1" }, { a: "2" })).toBe(false);
  });
});
