import { validateFeatureValue } from "shared/util";

// Pure (non-Mongo) coverage of the value-type validation that gates per-env
// override writes. Both the dedicated set endpoint and the general update path
// run the candidate override through `validateFeatureValue(feature, value,
// "Value")` before persisting it, so this is the shared rejection seam.

describe("validateFeatureValue for per-env override values", () => {
  it("rejects a non-numeric override for a number feature", () => {
    expect(() =>
      validateFeatureValue({ valueType: "number" }, "abc", "Value"),
    ).toThrow(/Value: Must be a valid number/);
  });

  it("accepts a numeric override for a number feature", () => {
    expect(validateFeatureValue({ valueType: "number" }, "42", "Value")).toBe(
      "42",
    );
  });

  it("coerces a non-boolean override for a boolean feature to a boolean string", () => {
    // Boolean coercion is lenient: anything truthy becomes "true".
    expect(validateFeatureValue({ valueType: "boolean" }, "yes", "Value")).toBe(
      "true",
    );
    expect(validateFeatureValue({ valueType: "boolean" }, "", "Value")).toBe(
      "false",
    );
  });

  it("keeps valid boolean override values", () => {
    expect(
      validateFeatureValue({ valueType: "boolean" }, "true", "Value"),
    ).toBe("true");
    expect(
      validateFeatureValue({ valueType: "boolean" }, "false", "Value"),
    ).toBe("false");
  });

  it("rejects malformed JSON for a json feature", () => {
    expect(() =>
      validateFeatureValue({ valueType: "json" }, "{not json", "Value"),
    ).toThrow(/Value:/);
  });

  it("accepts the JSON literal null as a real json override (not a clear)", () => {
    // Encoded "null" is a legitimate JSON value and must round-trip unchanged.
    expect(validateFeatureValue({ valueType: "json" }, "null", "Value")).toBe(
      "null",
    );
  });

  it("accepts a valid json object override", () => {
    expect(
      validateFeatureValue({ valueType: "json" }, '{"a":1}', "Value"),
    ).toBe('{"a":1}');
  });

  it("prefixes thrown errors with the provided label", () => {
    expect(() =>
      validateFeatureValue({ valueType: "number" }, "abc", "Custom Label"),
    ).toThrow(/^Custom Label: /);
  });
});
