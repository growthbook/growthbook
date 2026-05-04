import {
  stemRuleId,
  suffixRuleId,
  isMigrationSuffixedRuleId,
  parseRuleId,
  RULE_ID_ENV_SUFFIX_DELIMITER,
} from "shared/util";

describe("ruleId helpers", () => {
  describe("stemRuleId", () => {
    it("returns the id unchanged when no suffix is present", () => {
      expect(stemRuleId("fr_abc")).toBe("fr_abc");
      expect(stemRuleId("custom-id-with-dashes")).toBe("custom-id-with-dashes");
      expect(stemRuleId("")).toBe("");
    });

    it("strips a single env suffix", () => {
      expect(stemRuleId("fr_abc__production")).toBe("fr_abc");
      expect(stemRuleId("fr_abc__dev")).toBe("fr_abc");
    });

    it("strips a counter suffix (in-env duplicate)", () => {
      expect(stemRuleId("fr_abc__dev__2")).toBe("fr_abc");
      expect(stemRuleId("fr_abc__dev__17")).toBe("fr_abc");
    });

    it("is idempotent (stem of stem is stem)", () => {
      expect(stemRuleId(stemRuleId("fr_abc__production"))).toBe("fr_abc");
      expect(stemRuleId(stemRuleId(stemRuleId("fr_abc__prod__3")))).toBe(
        "fr_abc",
      );
    });

    it("preserves the standard `fr_<uniqid>` prefix (single underscore, not affected)", () => {
      // generateRuleId() output is `fr_<uniqid>`. The single underscore is
      // NOT a delimiter; `__` is. A generated id stems to itself.
      expect(stemRuleId("fr_lgw3b5x9k")).toBe("fr_lgw3b5x9k");
    });
  });

  describe("suffixRuleId", () => {
    it("appends an env suffix", () => {
      expect(suffixRuleId("fr_abc", "production")).toBe("fr_abc__production");
      expect(suffixRuleId("fr_abc", "dev")).toBe("fr_abc__dev");
    });

    it("omits the counter for occurrence <= 1", () => {
      expect(suffixRuleId("fr_abc", "dev")).toBe("fr_abc__dev");
      expect(suffixRuleId("fr_abc", "dev", 1)).toBe("fr_abc__dev");
      expect(suffixRuleId("fr_abc", "dev", 0)).toBe("fr_abc__dev");
    });

    it("appends a counter for occurrence >= 2", () => {
      expect(suffixRuleId("fr_abc", "dev", 2)).toBe("fr_abc__dev__2");
      expect(suffixRuleId("fr_abc", "dev", 17)).toBe("fr_abc__dev__17");
    });

    it("stem-round-trips: stemRuleId(suffixRuleId(stem, env)) === stem", () => {
      expect(stemRuleId(suffixRuleId("fr_abc", "production"))).toBe("fr_abc");
      expect(stemRuleId(suffixRuleId("fr_abc", "dev", 3))).toBe("fr_abc");
    });
  });

  describe("isMigrationSuffixedRuleId", () => {
    it("returns false for bare ids", () => {
      expect(isMigrationSuffixedRuleId("fr_abc")).toBe(false);
      expect(isMigrationSuffixedRuleId("")).toBe(false);
      expect(isMigrationSuffixedRuleId("single_underscore_ok")).toBe(false);
    });

    it("returns true for any id containing the delimiter", () => {
      expect(isMigrationSuffixedRuleId("fr_abc__dev")).toBe(true);
      expect(isMigrationSuffixedRuleId("fr_abc__dev__2")).toBe(true);
    });
  });

  describe("parseRuleId", () => {
    it("returns just the stem for bare ids", () => {
      expect(parseRuleId("fr_abc")).toEqual({ stem: "fr_abc" });
      expect(parseRuleId("fr_lgw3b5x9k")).toEqual({ stem: "fr_lgw3b5x9k" });
    });

    it("extracts stem and env for `stem__env` form", () => {
      expect(parseRuleId("fr_abc__production")).toEqual({
        stem: "fr_abc",
        env: "production",
      });
      expect(parseRuleId("fr_abc__dev")).toEqual({
        stem: "fr_abc",
        env: "dev",
      });
    });

    it("extracts stem, env, and occurrence for `stem__env__n` form", () => {
      expect(parseRuleId("fr_abc__dev__2")).toEqual({
        stem: "fr_abc",
        env: "dev",
        occurrence: 2,
      });
      expect(parseRuleId("fr_abc__production__17")).toEqual({
        stem: "fr_abc",
        env: "production",
        occurrence: 17,
      });
    });

    it("round-trips with suffixRuleId", () => {
      expect(parseRuleId(suffixRuleId("fr_abc", "dev"))).toEqual({
        stem: "fr_abc",
        env: "dev",
      });
      expect(parseRuleId(suffixRuleId("fr_abc", "prod", 3))).toEqual({
        stem: "fr_abc",
        env: "prod",
        occurrence: 3,
      });
    });
  });

  it("delimiter constant matches the two-underscore pattern the flattener emits", () => {
    // Lock-test: nothing else in the codebase should split on `__`. If we
    // ever change the delimiter, it happens here and the test moves with it.
    expect(RULE_ID_ENV_SUFFIX_DELIMITER).toBe("__");
  });
});
