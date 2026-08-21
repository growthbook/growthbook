import { castFeatureValue, validateFeatureValue } from "../src/util/features";

const cast = (value: string, from: string, to: string, index = 0) =>
  castFeatureValue({
    value,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    from: from as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    to: to as any,
    index,
  });

describe("castFeatureValue", () => {
  it("leaves a value alone when the type does not change", () => {
    expect(cast("anything", "string", "string")).toBe("anything");
    expect(cast("{bad json", "json", "json")).toBe("{bad json");
  });

  describe("to boolean", () => {
    it("reads the values that already mean true or false", () => {
      expect(cast("true", "string", "boolean")).toBe("true");
      expect(cast("false", "string", "boolean")).toBe("false");
      expect(cast("1", "number", "boolean")).toBe("true");
      expect(cast("0", "number", "boolean")).toBe("false");
    });

    it("is case and whitespace insensitive", () => {
      expect(cast("  TRUE ", "string", "boolean")).toBe("true");
      expect(cast("False", "string", "boolean")).toBe("false");
    });

    it("treats an absent value as false", () => {
      expect(cast("", "string", "boolean")).toBe("false");
      expect(cast("null", "string", "boolean")).toBe("false");
    });

    it("falls back to position when nothing about the value survives", () => {
      // Mapping every variation to one value would stop this being an
      // experiment, so control goes off and the rest go on.
      expect(cast("control", "string", "boolean", 0)).toBe("false");
      expect(cast("treatment", "string", "boolean", 1)).toBe("true");
      expect(cast("treatment-2", "string", "boolean", 2)).toBe("true");
    });

    it("reads through the JSON envelope", () => {
      expect(cast('{"value": true}', "json", "boolean")).toBe("true");
      expect(cast('{"value": "false"}', "json", "boolean")).toBe("false");
    });
  });

  describe("to number", () => {
    it("keeps a value that already reads as a number", () => {
      expect(cast("42", "string", "number")).toBe("42");
      expect(cast("-1.5", "string", "number")).toBe("-1.5");
    });

    it("maps booleans onto 0 and 1", () => {
      expect(cast("false", "boolean", "number")).toBe("0");
      // "true" is not numeric, so it falls back to the variation's position.
      expect(cast("true", "boolean", "number", 1)).toBe("1");
    });

    it("falls back to position for a value with no numeric reading", () => {
      expect(cast("control", "string", "number", 0)).toBe("0");
      expect(cast("treatment", "string", "number", 3)).toBe("3");
    });

    it("rejects the numeric readings JavaScript would otherwise allow", () => {
      // Number("") is 0 and Number("Infinity") is finite-looking; neither is a
      // value the caller meant.
      expect(cast("", "string", "number", 2)).toBe("2");
      expect(cast("Infinity", "string", "number", 2)).toBe("2");
    });
  });

  describe("to json", () => {
    it("quotes a string so the result parses", () => {
      const out = cast("hello", "string", "json");
      expect(JSON.parse(out)).toEqual({ value: "hello" });
    });

    it("keeps numbers and booleans as JSON literals", () => {
      expect(JSON.parse(cast("42", "number", "json"))).toEqual({ value: 42 });
      expect(JSON.parse(cast("true", "boolean", "json"))).toEqual({
        value: true,
      });
    });

    it("escapes a string that would otherwise break the JSON", () => {
      const out = cast('say "hi"\\nthen go', "string", "json");
      expect(JSON.parse(out)).toEqual({ value: 'say "hi"\\nthen go' });
    });
  });

  describe("to string", () => {
    it("unwraps a value that was moved into JSON", () => {
      expect(cast('{"value": "hello"}', "json", "string")).toBe("hello");
      expect(cast('{"value": 42}', "json", "string")).toBe("42");
    });

    it("keeps JSON that is not the cast envelope intact", () => {
      expect(cast('{"a": 1, "b": 2}', "json", "string")).toBe(
        '{"a": 1, "b": 2}',
      );
      expect(cast("[1,2]", "json", "string")).toBe("[1,2]");
    });

    it("keeps unparseable JSON as written", () => {
      expect(cast("{not json", "json", "string")).toBe("{not json");
    });

    it("passes booleans and numbers through as written", () => {
      expect(cast("true", "boolean", "string")).toBe("true");
      expect(cast("42", "number", "string")).toBe("42");
    });
  });

  describe("round trips", () => {
    it("returns a string unchanged through JSON", () => {
      const original = 'control "A"';
      const there = cast(original, "string", "json");
      expect(cast(there, "json", "string")).toBe(original);
    });

    it("returns a number unchanged through JSON", () => {
      expect(cast(cast("7", "number", "json"), "json", "number")).toBe("7");
    });

    it("returns a boolean unchanged through JSON", () => {
      expect(cast(cast("false", "boolean", "json"), "json", "boolean")).toBe(
        "false",
      );
    });
  });

  describe("every result is a value the field accepts", () => {
    const TYPES = ["string", "number", "boolean", "json"] as const;
    // Values a caller could plausibly already be serving, plus awkward ones.
    const SAMPLES = [
      "control",
      "treatment",
      "",
      "0",
      "1",
      "true",
      "false",
      "-1.5",
      "1e21",
      "Infinity",
      "NaN",
      '{"value": "x"}',
      '{"a": 1}',
      "[1,2]",
      "{not json",
      'quote " and \\ backslash',
      "0.00000001",
      "99999999999999999999999",
    ];

    TYPES.forEach((from) => {
      TYPES.forEach((to) => {
        // `from === to` is a documented passthrough, so only a real move has to
        // produce something the field will take.
        if (from === to) return;
        it(`${from} -> ${to}`, () => {
          SAMPLES.forEach((value, i) => {
            const out = castFeatureValue({ value, from, to, index: i % 3 });
            expect(() =>
              validateFeatureValue({ valueType: to }, out, value),
            ).not.toThrow();
          });
        });
      });
    });
  });
});
