import { SDKConnectionInterface } from "shared/types/sdk-connection";
import { getConnectionSDKCapabilities } from "../src/sdk-versioning";

const baseConnection: SDKConnectionInterface = {
  id: "sdk-123",
  organization: "org-123",
  name: "Simple SDK",
  dateCreated: new Date(2020, 1, 5, 10, 0, 0),
  dateUpdated: new Date(2020, 1, 5, 10, 0, 0),
  languages: ["javascript"],
  sdkVersion: "1.1.0",
  environment: "production",
  projects: [],
  encryptPayload: false,
  encryptionKey: "ouhdf98h1rouh",
  key: "key-123",
  connected: true,
  proxy: {
    enabled: false,
    host: "a.b.com",
    signingKey: "odafouh32013",
    connected: false,
    version: "1.0.0",
    error: "",
    lastError: null,
  },
};

describe("getConnectionSDKCapabilities", () => {
  it("Does a versioned lookup for a single-language connection", () => {
    const capabilities = getConnectionSDKCapabilities(baseConnection);
    expect(capabilities).toContainEqual("looseUnmarshalling");
    expect(capabilities).toContainEqual("semverTargeting");
    expect(capabilities).not.toContainEqual("remoteEvaluation");
  });

  it("Gets capabilities for the default version when no SDKVersion is provided", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
      sdkVersion: undefined,
    };
    const capabilities = getConnectionSDKCapabilities(connection);
    expect(capabilities).toStrictEqual([
      "visualEditorDragDrop",
      "remoteEval",
      "semverTargeting",
      "visualEditorJS",
      "visualEditor",
      "bucketingV2",
      "streaming",
      "encryption",
      "looseUnmarshalling",
    ]);
  });

  it("Gets a minimal intersection of capabilities for a multi-language connection", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
      languages: ["javascript", "python"],
    };
    const capabilities = getConnectionSDKCapabilities(connection); // should be empty due to Python 0.0.0 having nothing
    expect(capabilities).toStrictEqual(["bucketingV2", "encryption"]);
  });
});
