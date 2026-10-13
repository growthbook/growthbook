import { InterleavingInterface } from "shared/validators";
import { GroupMap, SavedGroupInterface } from "shared/types/saved-group";
import { OrganizationInterface } from "shared/types/organization";
import { getSavedGroupPayloadStrategy } from "shared/sdk-versioning";
import { ApiReqContext } from "back-end/types/api";
import {
  buildSDKPayloadForConnection,
  generateInterleavingsPayload,
  getFeatureDefinitionsResponse,
  type ConnectionPayloadOptions,
  type SDKPayloadRawData,
} from "back-end/src/services/features";

const ENCRYPTION_KEY = "test-key-32-bytes-long!!!!!!!!";

function interleaving(
  overrides: Partial<InterleavingInterface> = {},
): InterleavingInterface {
  return {
    id: "il_1",
    organization: "org-1",
    dateCreated: new Date(),
    dateUpdated: new Date(),
    name: "Search ranking",
    owner: "",
    tags: [],
    archived: false,
    status: "running",
    key: "search-ranking",
    trackingKey: "search-ranking-tk",
    hashAttribute: "id",
    seed: "il-seed",
    variations: [
      {
        id: "v0",
        key: "control",
        name: "Control",
        config: '{"algorithm":"popular"}',
      },
      {
        id: "v1",
        key: "buyers-pick",
        name: "Buyer's pick",
        config: '{"algorithm":"buyers-pick","weight":0.3}',
      },
    ],
    jsonSchema: null,
    datasource: "ds_1",
    interleavingQueryId: "q_1",
    userIdType: "user_id",
    metrics: [],
    environmentSettings: { production: { enabled: true } },
    ...overrides,
  };
}

function listGroup(id: string, values: string[]): SavedGroupInterface {
  return {
    id,
    organization: "org-1",
    groupName: id,
    owner: "",
    type: "list",
    attributeKey: "id",
    values,
    dateCreated: new Date(),
    dateUpdated: new Date(),
  } as SavedGroupInterface;
}

const v2Strategy = (groupMap: GroupMap) =>
  getSavedGroupPayloadStrategy({
    capabilities: ["savedGroupReferences", "savedGroupReferencesV2"],
    savedGroupFormat: "referencesV2",
    groupMap,
  });

function minimalContext(): ApiReqContext {
  return {
    org: {
      id: "org-1",
      name: "Test",
      url: "",
      dateCreated: new Date(),
      ownerEmail: "",
      members: [],
      invites: [],
    },
    models: {} as ApiReqContext["models"],
    userId: "u1",
    email: "e@e.com",
    userName: "User",
    initModels: () => {},
  } as ApiReqContext;
}

function rawData(overrides?: Partial<SDKPayloadRawData>): SDKPayloadRawData {
  return {
    features: [],
    experimentMap: new Map(),
    groupMap: new Map(),
    safeRolloutMap: new Map(),
    savedGroups: [],
    holdoutsMap: new Map(),
    visualExperiments: [],
    urlRedirectExperiments: [],
    ...overrides,
  };
}

function connection(
  overrides: Partial<ConnectionPayloadOptions> = {},
): ConnectionPayloadOptions {
  return {
    capabilities: ["bucketingV2", "prerequisites", "interleaving"],
    environment: "production",
    projects: [],
    ...overrides,
  };
}

describe("generateInterleavingsPayload", () => {
  const generate = (
    interleavings: InterleavingInterface[],
    {
      environment = "production",
      projects = [] as string[],
      groupMap = new Map() as GroupMap,
    } = {},
  ) =>
    generateInterleavingsPayload({
      interleavings,
      environment,
      projects,
      savedGroupStrategy: v2Strategy(groupMap),
    });

  it("builds the pseudo flag and the config entry for a running interleaving", () => {
    const out = generate([interleaving({ coverage: 0.5 })]);

    expect(out.features).toEqual({
      "$interleave:search-ranking": {
        defaultValue: "control",
        rules: [
          {
            id: "$interleave:search-ranking",
            force: { interleave: true },
            coverage: 0.5,
            hashAttribute: "id",
            seed: "il-seed",
            hashVersion: 2,
          },
        ],
      },
    });
    expect(out.interleavings).toEqual({
      "search-ranking": {
        trackingKey: "search-ranking-tk",
        variations: [
          { key: "control", config: { algorithm: "popular" } },
          {
            key: "buyers-pick",
            config: { algorithm: "buyers-pick", weight: 0.3 },
          },
        ],
      },
    });
  });

  it("ships the config but no flag once stopped", () => {
    const out = generate([interleaving({ status: "stopped" })]);
    expect(out.features).toEqual({});
    expect(Object.keys(out.interleavings ?? {})).toEqual(["search-ranking"]);
  });

  it.each([
    ["draft", { status: "draft" as const }],
    ["archived", { archived: true }],
    [
      "disabled in the environment",
      { environmentSettings: { production: { enabled: false } } },
    ],
    ["missing the environment", { environmentSettings: {} }],
  ])("omits an interleaving that is %s", (_, overrides) => {
    const out = generate([interleaving(overrides)]);
    expect(out.features).toEqual({});
    expect(out.interleavings).toBeUndefined();
  });

  it("scopes by the connection's projects", () => {
    const il = interleaving({ project: "p1" });
    expect(generate([il], { projects: ["p1"] }).interleavings).toBeDefined();
    expect(generate([il], { projects: ["p2"] }).interleavings).toBeUndefined();
    expect(generate([il]).interleavings).toBeDefined();
  });

  it("skips an interleaving whose ranker config no longer parses", () => {
    const [a, b] = interleaving().variations;
    const out = generate([
      interleaving({ variations: [a, { ...b, config: "{not json" }] }),
    ]);
    expect(out.features).toEqual({});
    expect(out.interleavings).toBeUndefined();
  });

  it("merges the condition, saved groups and prerequisites into the rule", () => {
    const groupMap: GroupMap = new Map([
      ["grp_beta", listGroup("grp_beta", ["u1"])],
    ]);
    const out = generate(
      [
        interleaving({
          condition: '{"country":"US"}',
          savedGroups: [{ match: "all", ids: ["grp_beta"] }],
          prerequisites: [{ id: "parent-flag", condition: '{"value":true}' }],
        }),
      ],
      { groupMap },
    );
    const rule = out.features["$interleave:search-ranking"].rules?.[0];
    expect(rule?.condition).toEqual({
      $and: [{ country: "US" }, { $savedGroup: { id: "grp_beta" } }],
    });
    expect(rule?.parentConditions).toEqual([
      { id: "parent-flag", condition: { value: true } },
    ]);
  });
});

describe("buildSDKPayloadForConnection with interleavings", () => {
  it("adds the pseudo flag and interleavings section for capable SDKs", async () => {
    const out = await buildSDKPayloadForConnection({
      context: minimalContext(),
      connection: connection(),
      data: rawData({ interleavings: [interleaving()] }),
    });
    expect(out.features["$interleave:search-ranking"]).toBeDefined();
    expect(out.interleavings?.["search-ranking"]).toBeDefined();
  });

  it("leaves both out for SDKs without the interleaving capability", async () => {
    const out = await buildSDKPayloadForConnection({
      context: minimalContext(),
      connection: connection({
        capabilities: ["bucketingV2", "prerequisites"],
      }),
      data: rawData({ interleavings: [interleaving()] }),
    });
    expect(out.features).toEqual({});
    expect(out).not.toHaveProperty("interleavings");
  });

  it("ships saved groups referenced only by an interleaving", async () => {
    const group = listGroup("grp_beta", ["u1"]);
    const out = await buildSDKPayloadForConnection({
      context: minimalContext(),
      connection: connection({
        capabilities: [
          "bucketingV2",
          "prerequisites",
          "interleaving",
          "savedGroupReferences",
          "savedGroupReferencesV2",
        ],
        savedGroupFormat: "referencesV2",
      }),
      data: rawData({
        interleavings: [
          interleaving({ savedGroups: [{ match: "all", ids: ["grp_beta"] }] }),
        ],
        groupMap: new Map([["grp_beta", group]]),
        savedGroups: [group],
      }),
    });
    expect(Object.keys(out.savedGroups ?? {})).toContain("grp_beta");
  });
});

describe("getFeatureDefinitionsResponse with interleavings", () => {
  const interleavings = {
    "search-ranking": {
      trackingKey: "tk",
      variations: [
        { key: "control", config: {} },
        { key: "treatment", config: {} },
      ],
    },
  };
  const base = {
    features: {},
    dateUpdated: new Date(),
    usedSavedGroups: [],
    interleavings,
    organization: minimalContext().org as OrganizationInterface,
  };

  it("encrypts the interleavings section", async () => {
    const out = await getFeatureDefinitionsResponse({
      ...base,
      capabilities: ["interleaving"],
      encryptPayload: true,
      encryptionKey: ENCRYPTION_KEY,
    });
    expect(out.encryptedInterleavings).toBeDefined();
    expect(out).not.toHaveProperty("interleavings");
  });

  it("drops the section without the capability", async () => {
    const out = await getFeatureDefinitionsResponse({
      ...base,
      capabilities: [],
    });
    expect(out).not.toHaveProperty("interleavings");
  });
});
