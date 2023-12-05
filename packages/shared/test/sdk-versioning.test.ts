import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import cloneDeep from "lodash/cloneDeep";
import {
  getConnectionSDKCapabilities,
  scrubExperiments,
  scrubFeatures,
} from "../src/sdk-versioning";

const baseConnection: SDKConnectionInterface = {
  id: "sdk-123",
  organization: "org-123",
  name: "Simple SDK",
  dateCreated: new Date(2020, 1, 5, 10, 0, 0),
  dateUpdated: new Date(2020, 1, 5, 10, 0, 0),
  languages: ["javascript"],
  sdkVersion: "0.27.0",
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
    expect(capabilities).toStrictEqual(["bucketingV2"]);
  });
});

describe("payload scrubbing", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sdkPayload: any = {
    features: {
      exp1: {
        defaultValue: "control",
        rules: [
          {
            key: "feature-exp",
            seed: "feature-exp",
            hashAttribute: "id",
            fallbackAttribute: "deviceId",
            hashVersion: 2,
            bucketVersion: 1,
            condition: { country: "USA" },
            variations: ["control", "red", "blue"],
            coverage: 1,
            weights: [0.3334, 0.3333, 0.3333],
            phase: "0",
          },
        ],
      },
    },
    experiments: [
      {
        key: "my-experiment",
        seed: "s1",
        hashAttribute: "id",
        fallbackAttribute: "anonymousId",
        hashVersion: 2,
        bucketVersion: 1,
        stickyBucketing: true,
        manual: true,
        variations: [
          {},
          {
            domMutations: [
              {
                selector: "h1",
                action: "set",
                attribute: "html",
                value: "red",
              },
            ],
          },
          {
            domMutations: [
              {
                selector: "h1",
                action: "set",
                attribute: "html",
                value: "blue",
              },
            ],
          },
        ],
        weights: [0.3334, 0.3333, 0.3333],
        coverage: 1,
      },
    ],
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scrubbedPayload: any = {
    features: {
      exp1: {
        defaultValue: "control",
        rules: [
          {
            key: "feature-exp",
            seed: "feature-exp",
            hashAttribute: "id",
            // fallbackAttribute: "deviceId",
            hashVersion: 2,
            // bucketVersion: 1,
            condition: { country: "USA" },
            variations: ["control", "red", "blue"],
            coverage: 1,
            weights: [0.3334, 0.3333, 0.3333],
            phase: "0",
          },
        ],
      },
    },
    experiments: [
      {
        key: "my-experiment",
        seed: "s1",
        hashAttribute: "id",
        // fallbackAttribute: "anonymousId",
        hashVersion: 2,
        // bucketVersion: 1,
        // stickyBucketing: true,
        // manual: true,
        variations: [
          {},
          {
            domMutations: [
              {
                selector: "h1",
                action: "set",
                attribute: "html",
                value: "red",
              },
            ],
          },
          {
            domMutations: [
              {
                selector: "h1",
                action: "set",
                attribute: "html",
                value: "blue",
              },
            ],
          },
        ],
        weights: [0.3334, 0.3333, 0.3333],
        coverage: 1,
      },
    ],
  };

  it("does not scrub the payload for a safe language version", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
    };
    const capabilities = getConnectionSDKCapabilities(connection);

    const scrubbed = cloneDeep(sdkPayload);
    const scrubbedFeatures = scrubFeatures(scrubbed.features, capabilities);
    const scrubbedExperiments = scrubExperiments(
      scrubbed.experiments,
      capabilities
    );
    scrubbed.features = scrubbedFeatures;
    scrubbed.experiments = scrubbedExperiments;

    // no change to payload for default connection (javascript, 0.27.0)
    expect(scrubbed).toStrictEqual(sdkPayload);
  });

  it("scrubs the payload for a risky language version", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
      languages: ["python"],
      sdkVersion: "0.0.0",
    };
    const capabilities = getConnectionSDKCapabilities(connection);

    const scrubbed = cloneDeep(sdkPayload);
    const scrubbedFeatures = scrubFeatures(scrubbed.features, capabilities);
    const scrubbedExperiments = scrubExperiments(
      scrubbed.experiments,
      capabilities
    );
    scrubbed.features = scrubbedFeatures;
    scrubbed.experiments = scrubbedExperiments;

    // no change to payload for default connection (javascript, 0.27.0)
    expect(scrubbed).toStrictEqual(scrubbedPayload);
  });

  it("scrubs as necessary for multi-language SDKs", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
      languages: ["python", "php", "javascript"],
      sdkVersion: undefined,
    };
    const capabilities = getConnectionSDKCapabilities(connection);

    const scrubbed = cloneDeep(sdkPayload);
    const scrubbedFeatures = scrubFeatures(scrubbed.features, capabilities);
    const scrubbedExperiments = scrubExperiments(
      scrubbed.experiments,
      capabilities
    );
    scrubbed.features = scrubbedFeatures;
    scrubbed.experiments = scrubbedExperiments;

    // no change to payload for default connection (javascript, 0.27.0)
    expect(scrubbed).toStrictEqual(scrubbedPayload);
  });
});
