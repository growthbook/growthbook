import { getFeatureDefinitionsWithCache } from "back-end/src/controllers/features";
import { getFeatureDefinitions } from "back-end/src/services/features";

// getConnectionSDKCapabilities reads the real SDK version data, and no SDK
// declares savedGroupReferencesV2 yet. Force it to so the filter has something
// to strip; without this the test would pass for the wrong reason.
jest.mock("shared/sdk-versioning", () => ({
  ...jest.requireActual("shared/sdk-versioning"),
  getConnectionSDKCapabilities: jest
    .fn()
    .mockReturnValue([
      "bucketingV2",
      "prerequisites",
      "savedGroupReferences",
      "savedGroupReferencesV2",
    ]),
}));

// Replaced wholesale rather than with requireActual, which pulls in a circular
// module graph. Only getFeatureDefinitions is called on this path.
jest.mock("back-end/src/services/features", () => ({
  getFeatureDefinitions: jest.fn().mockResolvedValue({
    features: {},
    dateUpdated: new Date(),
  }),
  getSavedGroupMap: jest.fn(),
}));

jest.mock("back-end/src/models/SdkConnectionCacheModel", () => ({
  getSDKPayloadCacheLocation: jest.fn().mockReturnValue("none"),
  SdkConnectionCacheModel: jest.fn(),
}));

jest.mock("back-end/src/services/python", () => ({
  statsServerPool: { acquire: jest.fn(), release: jest.fn() },
}));

describe("getFeatureDefinitionsWithCache remote-eval capabilities", () => {
  const context = {
    org: {
      id: "test-org-id",
      settings: { environments: [{ id: "production", projects: [] }] },
    },
  };

  const baseParams = {
    key: "test-key",
    organization: "test-org-id",
    environment: "production",
    projects: [],
    encryptPayload: false,
    encryptionKey: "",
    languages: ["javascript"],
    sdkVersion: "1.0.0",
  };

  const capabilitiesUsed = () =>
    (getFeatureDefinitions as jest.Mock).mock.calls[0][0].capabilities;

  beforeEach(() => {
    (getFeatureDefinitions as jest.Mock).mockClear();
  });

  it("keeps savedGroupReferencesV2 for a normal connection", async () => {
    await getFeatureDefinitionsWithCache({
      context,
      params: { ...baseParams, remoteEvalEnabled: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(capabilitiesUsed()).toContain("savedGroupReferencesV2");
  });

  it("strips savedGroupReferencesV2 for a remote-eval connection on a cache miss", async () => {
    // The cache-refresh path filters separately. This path derives capabilities
    // again, so without its own filter the same connection would get a payload
    // proxy-eval cannot evaluate.
    await getFeatureDefinitionsWithCache({
      context,
      params: { ...baseParams, remoteEvalEnabled: true },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(capabilitiesUsed()).not.toContain("savedGroupReferencesV2");
    expect(capabilitiesUsed()).toContain("savedGroupReferences");
  });
});
