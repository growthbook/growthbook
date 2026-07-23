import {
  featureRevisionId,
  parseFeatureRevisionId,
} from "back-end/src/models/FeatureRevisionModel";

// The id is a pure projection of the immutable natural key — version-first so
// parsing stays unambiguous no matter what characters the featureId contains.

describe("featureRevisionId", () => {
  it("round-trips, including underscore- and digit-heavy feature ids", () => {
    const cases: [string, number][] = [
      ["my-flag", 2],
      ["my_flag_v2", 14],
      ["2_weird_start", 1],
      ["dots.and-dashes_and_underscores", 999],
    ];
    for (const [featureId, version] of cases) {
      const id = featureRevisionId(featureId, version);
      expect(parseFeatureRevisionId(id)).toEqual({ featureId, version });
    }
  });

  it("is version-first and deterministic", () => {
    expect(featureRevisionId("my_flag", 3)).toBe("frev_3_my_flag");
  });

  it("rejects shapes that are not tuple ids", () => {
    expect(parseFeatureRevisionId("rev_abc123")).toBeNull();
    expect(parseFeatureRevisionId("frev_notanumber_x")).toBeNull();
    expect(parseFeatureRevisionId("frev_3")).toBeNull();
  });

  it("never parses minted opaque ids as tuples (shape-routed lookup relies on this)", () => {
    // uniqid suffixes are purely alphanumeric — no underscores — so a minted
    // `frev_<uniqid>` id can never satisfy the digits-then-underscore tuple
    // shape, keeping the two lookup routes disjoint by construction.
    expect(parseFeatureRevisionId("frev_kx8w2p1qabc9")).toBeNull();
    expect(parseFeatureRevisionId("frev_1707318958123abc")).toBeNull();
  });
});
