import { SDKConnectionInterface } from "back-end/types/sdk-connection";
import cloneDeep from "lodash/cloneDeep";
import { OrganizationInterface } from "back-end/types/organization";
import {
  getConnectionSDKCapabilities,
  scrubFeatures,
  scrubSavedGroups,
} from "../src/sdk-versioning";
import { getSavedGroupsValuesFromInterfaces } from "../util";
import { SavedGroupInterface } from "../types/groups";

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

const baseOrg: OrganizationInterface = {
  dateCreated: new Date(),
  id: "",
  invites: [],
  members: [],
  name: "",
  ownerEmail: "",
  url: "",
  settings: {
    attributeSchema: [
      {
        datatype: "string",
        property: "id",
      },
      {
        datatype: "number",
        property: "num",
      },
    ],
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

describe("payload scrubbing", () => {
  const savedGroups: SavedGroupInterface[] = [
    {
      id: "legacy_group_id",
      organization: baseConnection.organization,
      groupName: "legacy group name",
      owner: "test user",
      dateCreated: new Date(2020, 1, 5, 10, 0, 0),
      dateUpdated: new Date(2020, 1, 5, 10, 0, 0),
      type: "list",
      values: ["1", "2", "3"],
      attributeKey: "id",
    },
    {
      id: "large_group_id",
      organization: baseConnection.organization,
      groupName: "large group name",
      owner: "test user",
      dateCreated: new Date(2020, 1, 5, 10, 0, 0),
      dateUpdated: new Date(2020, 1, 5, 10, 0, 0),
      type: "list",
      values: ["4", "5", "6"],
    },
    {
      id: "legacy_numeric_group_id",
      organization: baseConnection.organization,
      groupName: "legacy numeric group name",
      owner: "test user",
      dateCreated: new Date(2020, 1, 5, 10, 0, 0),
      dateUpdated: new Date(2020, 1, 5, 10, 0, 0),
      type: "list",
      values: ["1", "2", "3"],
      attributeKey: "num",
    },
  ];
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
      feat2: {
        defaultValue: "control",
        rules: [
          {
            condition: {
              id: {
                $inGroup: "legacy_group_id",
              },
            },
            force: "variant",
          },
          {
            condition: {
              id: {
                $inGroup: "large_group_id",
              },
            },
            force: "variant",
          },
          {
            condition: {
              num: {
                $inGroup: "legacy_numeric_group_id",
              },
            },
            force: "variant",
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
    savedGroups: getSavedGroupsValuesFromInterfaces(savedGroups, baseOrg),
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const savedGroupScrubbedPayload: any = {
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
      feat2: {
        defaultValue: "control",
        rules: [
          {
            condition: {
              id: {
                $in: ["1", "2", "3"],
              },
            },
            force: "variant",
          },
          {
            condition: {
              id: {
                $in: ["4", "5", "6"],
              },
            },
            force: "variant",
          },
          {
            condition: {
              num: {
                $in: [1, 2, 3],
              },
            },
            force: "variant",
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
    savedGroups: undefined,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lightlyScrubbedPayload: any = {
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
      feat2: {
        defaultValue: "control",
        rules: [
          {
            condition: {
              id: {
                $in: ["1", "2", "3"],
              },
            },
            force: "variant",
          },
          {
            condition: {
              id: {
                $in: ["4", "5", "6"],
              },
            },
            force: "variant",
          },
          {
            condition: {
              num: {
                $in: [1, 2, 3],
              },
            },
            force: "variant",
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
    savedGroups: undefined,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fullyScrubbedPayload: any = {
    features: {
      exp1: {
        defaultValue: "control",
        rules: [
          {
            key: "feature-exp",
            // seed: "feature-exp",
            hashAttribute: "id",
            // fallbackAttribute: "deviceId",
            // hashVersion: 2,
            // bucketVersion: 1,
            condition: { country: "USA" },
            variations: ["control", "red", "blue"],
            coverage: 1,
            weights: [0.3334, 0.3333, 0.3333],
            // phase: "0",
          },
        ],
      },
      feat2: {
        defaultValue: "control",
        rules: [
          {
            condition: {
              id: {
                $in: ["1", "2", "3"],
              },
            },
            force: "variant",
          },
          {
            condition: {
              id: {
                $in: ["4", "5", "6"],
              },
            },
            force: "variant",
          },
          {
            condition: {
              num: {
                $in: [1, 2, 3],
              },
            },
            force: "variant",
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
    savedGroups: undefined,
  };

  it("scrubs the payload when savedGroupReferencesEnabled is false", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
    };
    const capabilities = getConnectionSDKCapabilities(connection);

    const scrubbed = cloneDeep(sdkPayload);
    const scrubbedFeatures = scrubFeatures(
      scrubbed.features,
      capabilities,
      savedGroups,
      false,
      baseOrg,
    );
    scrubbed.features = scrubbedFeatures;
    scrubbed.savedGroups = scrubSavedGroups(
      scrubbed.savedGroups,
      capabilities,
      false,
    );

    // only payload change for default connection (javascript, 0.27.0) is saved groups being inline
    expect(scrubbed).toStrictEqual(savedGroupScrubbedPayload);
  });

  it("does not scrub the payload when savedGroupReferencesEnabled is true", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
    };
    const capabilities = getConnectionSDKCapabilities(connection);

    const scrubbed = cloneDeep(sdkPayload);
    const scrubbedFeatures = scrubFeatures(
      scrubbed.features,
      capabilities,
      savedGroups,
      true,
      baseOrg,
    );
    scrubbed.features = scrubbedFeatures;
    scrubbed.savedGroups = scrubSavedGroups(
      scrubbed.savedGroups,
      capabilities,
      true,
    );

    // no change to payload for default connection (javascript, 0.27.0)
    expect(scrubbed).toStrictEqual(sdkPayload);
  });

  it("scrubs the payload for a risky language version, even if savedGroupReferencesEnabled is true", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
      languages: ["python"],
      sdkVersion: "0.0.0",
    };
    const capabilities = getConnectionSDKCapabilities(connection);
    expect(capabilities).toStrictEqual([]);

    const scrubbed = cloneDeep(sdkPayload);
    const scrubbedFeatures = scrubFeatures(
      scrubbed.features,
      capabilities,
      savedGroups,
      true,
      baseOrg,
    );
    scrubbed.features = scrubbedFeatures;
    scrubbed.savedGroups = scrubSavedGroups(
      scrubbed.savedGroups,
      capabilities,
      true,
    );

    // fully scrubs payload for risky connection (python, 0.0.0)
    expect(scrubbed).toStrictEqual(fullyScrubbedPayload);
  });

  it("scrubs as necessary for multi-language SDKs", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
      languages: ["python", "php", "javascript"],
      sdkVersion: undefined,
    };
    const capabilities = getConnectionSDKCapabilities(connection);
    expect(capabilities).toStrictEqual(["bucketingV2", "encryption"]);

    const scrubbed = cloneDeep(sdkPayload);
    const scrubbedFeatures = scrubFeatures(
      scrubbed.features,
      capabilities,
      savedGroups,
      true,
      baseOrg,
    );
    scrubbed.savedGroups = scrubSavedGroups(
      scrubbed.savedGroups,
      capabilities,
      true,
    );
    scrubbed.features = scrubbedFeatures;

    // no change to payload for default connection (javascript, 0.27.0)
    expect(scrubbed).toStrictEqual(lightlyScrubbedPayload);
  });

  it("scrubs as necessary for multi-language SDKs, expands looseUnmarshalling", () => {
    const connection: SDKConnectionInterface = {
      ...baseConnection,
      languages: ["javascript", "python", "nodejs", "flutter", "other"],
      sdkVersion: undefined,
    };
    const capabilities = getConnectionSDKCapabilities(connection);

    expect(capabilities).toStrictEqual(["bucketingV2"]);

    const scrubbed = cloneDeep(sdkPayload);
    const scrubbedFeatures = scrubFeatures(
      scrubbed.features,
      capabilities,
      savedGroups,
      true,
      baseOrg,
    );
    scrubbed.savedGroups = scrubSavedGroups(
      scrubbed.savedGroups,
      capabilities,
      true,
    );
    scrubbed.features = scrubbedFeatures;

    expect(scrubbed).toStrictEqual(lightlyScrubbedPayload);
  });
});
