import {
  buildDefinitionsEtag,
  ifNoneMatchMatches,
} from "back-end/src/util/definitionsEtag";

describe("definitions ETag helpers", () => {
  describe("buildDefinitionsEtag", () => {
    it("composes version, org, and permissions fingerprint into a strong ETag", () => {
      expect(buildDefinitionsEtag(0, "org_1", "abc")).toBe('"v0-org_1-abc"');
      expect(buildDefinitionsEtag(42, "org_2", "deadbeef")).toBe(
        '"v42-org_2-deadbeef"',
      );
    });

    it("varies by version, org, and fingerprint", () => {
      expect(buildDefinitionsEtag(1, "org_1", "abc")).not.toBe(
        buildDefinitionsEtag(2, "org_1", "abc"),
      );
      // Same version + fingerprint across two orgs must not collide — the URL
      // is shared across orgs, so this is what prevents a cross-org 304.
      expect(buildDefinitionsEtag(1, "org_1", "abc")).not.toBe(
        buildDefinitionsEtag(1, "org_2", "abc"),
      );
      expect(buildDefinitionsEtag(1, "org_1", "abc")).not.toBe(
        buildDefinitionsEtag(1, "org_1", "xyz"),
      );
    });
  });

  describe("ifNoneMatchMatches", () => {
    const etag = buildDefinitionsEtag(5, "org_1", "abc");

    it("returns false when the header is absent", () => {
      expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
      expect(ifNoneMatchMatches("", etag)).toBe(false);
    });

    it("matches an exact strong ETag", () => {
      expect(ifNoneMatchMatches(etag, etag)).toBe(true);
    });

    it("does not match a different ETag", () => {
      expect(
        ifNoneMatchMatches(buildDefinitionsEtag(4, "org_1", "abc"), etag),
      ).toBe(false);
    });

    it("matches within a comma-separated list", () => {
      expect(
        ifNoneMatchMatches(`"v1-org_1-abc", ${etag}, "v9-org_1-abc"`, etag),
      ).toBe(true);
    });

    it("matches an array-valued header", () => {
      expect(ifNoneMatchMatches(['"v1-org_1-abc"', etag], etag)).toBe(true);
    });

    it("matches a weak validator against our strong ETag", () => {
      expect(ifNoneMatchMatches(`W/${etag}`, etag)).toBe(true);
    });

    it("does not treat the wildcard as a match (safe direction: extra 200)", () => {
      expect(ifNoneMatchMatches("*", etag)).toBe(false);
    });
  });
});
