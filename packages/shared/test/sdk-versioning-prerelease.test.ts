import {
  getLatestSDKVersion,
  getSDKCapabilities,
  getSDKCapabilityVersion,
  getSDKVersions,
  isSDKOutdated,
} from "../src/sdk-versioning";

jest.mock("../src/sdk-versioning/sdk-versions/rust.json", () => ({
  versions: [
    {
      version: "2.0.0",
      prerelease: true,
      capabilities: ["savedGroupReferencesV2"],
    },
    { version: "1.1.0", capabilities: ["savedGroupReferences"] },
    { version: "1.0.0", capabilities: ["encryption"] },
  ],
}));

describe("prerelease SDK versions", () => {
  it("are left out of the version list", () => {
    expect(getSDKVersions("rust")).toEqual(["1.1.0", "1.0.0"]);
  });

  it("are never the latest version", () => {
    expect(getLatestSDKVersion("rust")).toBe("1.1.0");
    expect(isSDKOutdated("rust", "1.1.0")).toBe(false);
  });

  it("are never named as the version a capability needs", () => {
    expect(getSDKCapabilityVersion("rust", "savedGroupReferencesV2")).toBe(
      null,
    );
    expect(getSDKCapabilityVersion("rust", "savedGroupReferences")).toBe(
      "1.1.0",
    );
  });

  it("still give their capabilities to a connection set to that version", () => {
    expect(getSDKCapabilities("rust", "2.0.0").sort()).toEqual([
      "encryption",
      "savedGroupReferences",
      "savedGroupReferencesV2",
    ]);
    expect(getSDKCapabilities("rust", "2.1.0")).toContain(
      "savedGroupReferencesV2",
    );
  });

  it("do not give their capabilities to older versions", () => {
    expect(getSDKCapabilities("rust", "1.1.0")).not.toContain(
      "savedGroupReferencesV2",
    );
  });
});
