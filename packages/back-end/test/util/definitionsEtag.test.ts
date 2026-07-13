import {
  buildDefinitionsEtag,
  ifNoneMatchMatches,
} from "back-end/src/util/definitionsEtag";

describe("definitions ETag helpers", () => {
  describe("buildDefinitionsEtag", () => {
    it("composes version and permissions fingerprint into a strong ETag", () => {
      expect(buildDefinitionsEtag(0, "abc")).toBe('"v0-abc"');
      expect(buildDefinitionsEtag(42, "deadbeef")).toBe('"v42-deadbeef"');
    });

    it("varies by both version and fingerprint", () => {
      expect(buildDefinitionsEtag(1, "abc")).not.toBe(
        buildDefinitionsEtag(2, "abc"),
      );
      expect(buildDefinitionsEtag(1, "abc")).not.toBe(
        buildDefinitionsEtag(1, "xyz"),
      );
    });
  });

  describe("ifNoneMatchMatches", () => {
    const etag = buildDefinitionsEtag(5, "abc");

    it("returns false when the header is absent", () => {
      expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
      expect(ifNoneMatchMatches("", etag)).toBe(false);
    });

    it("matches an exact strong ETag", () => {
      expect(ifNoneMatchMatches(etag, etag)).toBe(true);
    });

    it("does not match a different ETag", () => {
      expect(ifNoneMatchMatches(buildDefinitionsEtag(4, "abc"), etag)).toBe(
        false,
      );
    });

    it("matches within a comma-separated list", () => {
      expect(ifNoneMatchMatches(`"v1-abc", ${etag}, "v9-abc"`, etag)).toBe(
        true,
      );
    });

    it("matches an array-valued header", () => {
      expect(ifNoneMatchMatches(['"v1-abc"', etag], etag)).toBe(true);
    });

    it("matches a weak validator against our strong ETag", () => {
      expect(ifNoneMatchMatches(`W/${etag}`, etag)).toBe(true);
    });

    it("does not treat the wildcard as a match (resource always exists here)", () => {
      expect(ifNoneMatchMatches("*", etag)).toBe(false);
    });
  });
});
