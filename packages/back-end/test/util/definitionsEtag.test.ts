import {
  buildDefinitionsEtag,
  ifNoneMatchMatches,
} from "back-end/src/util/definitionsEtag";
import { definitionsScope } from "back-end/src/models/DefinitionsVersionModel";

const etagFor = (
  args: Partial<Parameters<typeof buildDefinitionsEtag>[0]> = {},
) =>
  buildDefinitionsEtag({
    version: 0,
    organization: "org_1",
    permissionsFingerprint: "abc",
    ...args,
  });

describe("definitions ETag helpers", () => {
  describe("buildDefinitionsEtag", () => {
    it("composes version, org, and permissions fingerprint into a strong ETag", () => {
      expect(etagFor()).toBe('"v0-org_1-abc"');
      expect(
        etagFor({
          version: 42,
          organization: "org_2",
          permissionsFingerprint: "deadbeef",
        }),
      ).toBe('"v42-org_2-deadbeef"');
    });

    it("appends the config file hash only when using file config", () => {
      expect(etagFor({ version: 1, configFileHash: "filehash" })).toBe(
        '"v1-org_1-abc-filehash"',
      );
      expect(etagFor({ version: 1, configFileHash: null })).toBe(
        '"v1-org_1-abc"',
      );
      // File config toggling on/off or the file changing must change the ETag.
      expect(etagFor({ version: 1, configFileHash: "filehash" })).not.toBe(
        etagFor({ version: 1, configFileHash: null }),
      );
      expect(etagFor({ version: 1, configFileHash: "hash1" })).not.toBe(
        etagFor({ version: 1, configFileHash: "hash2" }),
      );
    });

    it("varies by version, org, and fingerprint", () => {
      expect(etagFor({ version: 1 })).not.toBe(etagFor({ version: 2 }));
      // Same version + fingerprint across two orgs must not collide — the URL
      // is shared across orgs, so this is what prevents a cross-org 304.
      expect(etagFor({ version: 1, organization: "org_1" })).not.toBe(
        etagFor({ version: 1, organization: "org_2" }),
      );
      expect(etagFor({ version: 1, permissionsFingerprint: "abc" })).not.toBe(
        etagFor({ version: 1, permissionsFingerprint: "xyz" }),
      );
    });

    describe("per-project versions", () => {
      const projectVersions = { proj_a: 1, proj_b: 2 };

      it("ignores project versions for projects the user cannot read", () => {
        // A reader of only proj_a is unaffected by a proj_b bump.
        expect(etagFor({ projectVersions, readableProjects: ["proj_a"] })).toBe(
          etagFor({
            projectVersions: { ...projectVersions, proj_b: 999 },
            readableProjects: ["proj_a"],
          }),
        );
      });

      it("changes when a readable project's version changes", () => {
        expect(
          etagFor({ projectVersions, readableProjects: ["proj_a"] }),
        ).not.toBe(
          etagFor({
            projectVersions: { ...projectVersions, proj_a: 5 },
            readableProjects: ["proj_a"],
          }),
        );
      });

      it("omits the project part when the reader has no relevant versions", () => {
        // Never-written project → no entry → identical to the bare ETag.
        expect(etagFor({ projectVersions, readableProjects: ["proj_x"] })).toBe(
          etagFor(),
        );
      });

      it("is order-independent in the project versions", () => {
        expect(
          etagFor({
            projectVersions: { proj_a: 1, proj_b: 2 },
            readableProjects: ["proj_a", "proj_b"],
          }),
        ).toBe(
          etagFor({
            projectVersions: { proj_b: 2, proj_a: 1 },
            readableProjects: ["proj_b", "proj_a"],
          }),
        );
      });

      it("folds in every project for a global reader (readableProjects=null)", () => {
        // A global reader must be invalidated by any project bump.
        expect(etagFor({ projectVersions, readableProjects: null })).not.toBe(
          etagFor({
            projectVersions: { ...projectVersions, proj_b: 3 },
            readableProjects: null,
          }),
        );
      });
    });
  });

  describe("ifNoneMatchMatches", () => {
    const etag = etagFor({ version: 5 });

    it("returns false when the header is absent", () => {
      expect(ifNoneMatchMatches(undefined, etag)).toBe(false);
      expect(ifNoneMatchMatches("", etag)).toBe(false);
    });

    it("matches an exact strong ETag", () => {
      expect(ifNoneMatchMatches(etag, etag)).toBe(true);
    });

    it("does not match a different ETag", () => {
      expect(ifNoneMatchMatches(etagFor({ version: 4 }), etag)).toBe(false);
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

describe("definitionsScope", () => {
  it("returns global when any list is empty or undefined (all projects)", () => {
    expect(definitionsScope([])).toBe("global");
    expect(definitionsScope(undefined)).toBe("global");
    expect(definitionsScope(["proj_a"], [])).toBe("global");
    expect(definitionsScope(["proj_a"], undefined)).toBe("global");
  });

  it("returns the union of the given project lists", () => {
    expect(definitionsScope(["proj_a"])).toEqual(["proj_a"]);
    expect(
      [
        ...(definitionsScope(["proj_a"], ["proj_b", "proj_a"]) as string[]),
      ].sort(),
    ).toEqual(["proj_a", "proj_b"]);
  });

  it("drops empty-string project ids", () => {
    expect(definitionsScope([""])).toBe("global");
    expect(definitionsScope(["proj_a", ""])).toEqual(["proj_a"]);
  });

  it("falls back to global for ids a Mongo field path can't represent", () => {
    // A dotted/$-prefixed id would nest under `projectVersions.<id>` on write
    // while the reader looks up the flat key — never matching, i.e. permanent
    // stale 304s. Global over-invalidates but can never serve stale.
    expect(definitionsScope(["proj.a"])).toBe("global");
    expect(definitionsScope(["$proj"])).toBe("global");
    expect(definitionsScope(["proj_a", "proj.b"])).toBe("global");
  });
});
