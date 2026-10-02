import mongoose from "mongoose";
import isEqual from "lodash/isEqual";
import type { OrganizationInterface } from "shared/types/organization";
import type {
  SavedGroupFormat,
  SDKConnectionInterface,
} from "shared/types/sdk-connection";
import { getLatestSDKVersion, getSDKCapabilities } from "shared/sdk-versioning";
import type { ApiReqContext } from "back-end/types/api";
import { waitForIndexes } from "back-end/src/models/BaseModel";
import type { SavedGroupModel } from "back-end/src/models/SavedGroupModel";
import { getContextForAgendaJobByOrgObject } from "back-end/src/services/organizations";
import {
  getFeatureDefinitions,
  refreshSDKPayloadCache,
} from "back-end/src/services/features";
import {
  connectTestMongo,
  disconnectTestMongo,
} from "back-end/test/test-helpers";

/**
 * Differential parity for the SDK payload's saved-group scope.
 *
 * The payload builders used to load every saved group in the org; they now
 * load only the groups the features and experiments being compiled reference
 * (collector + nested loader + getByIdsWithValues). Against one seeded org,
 * this builds the same connection's payload both ways, through both builders
 * (getFeatureDefinitions and refreshSDKPayloadCache), and asserts it is
 * identical, for an inline connection and both reference formats.
 *
 * Every referenced group is a canary: dropping it from the loaded set must
 * change the payload, otherwise the parity assertion would not be watching it.
 */

// The cache refresh notifies webhooks, proxies and the CDN through the job
// queue, which this suite does not start.
jest.mock("back-end/src/jobs/updateAllJobs", () => ({
  triggerWebhookJobs: jest.fn().mockResolvedValue(undefined),
}));

jest.setTimeout(60000);

const ORG_ID = "org_payload_saved_group_scope";
const NOW = new Date("2026-01-01T00:00:00.000Z");
const HUGE_VALUE_COUNT = 20_000;

const org = {
  id: ORG_ID,
  name: "Payload saved-group scope",
  ownerEmail: "owner@example.com",
  url: "",
  dateCreated: NOW,
  members: [],
  invites: [],
  settings: {
    environments: [{ id: "production", description: "" }],
    attributeSchema: [
      { property: "id", datatype: "string", hashAttribute: true },
      { property: "country", datatype: "string" },
      { property: "age", datatype: "number" },
    ],
  },
} as unknown as OrganizationInterface;

// Every saved group some definition in the fixture reads, keyed by id, with
// the path that reads it. Nothing else in the org may reach a payload.
const CANARIES: Record<string, string> = {
  grp_chain_1: "rule savedGroups -> condition group, depth 1 of 3",
  grp_chain_2: "condition group nested at depth 2 of 3",
  grp_chain_3: "condition group nested at depth 3 of 3",
  grp_chain_list: "ID list at the end of the 3-deep chain",
  grp_rule_list: "ID list referenced only from a rule's savedGroups array",
  grp_feature_prereq_list:
    "ID list referenced only inside a feature-level prerequisite condition",
  grp_rule_prereq_list:
    "ID list referenced only inside a rule-level prerequisite condition",
  grp_exp_condition:
    "$notInGroup nested in $or/$not of an experiment-ref phase condition",
  grp_exp_phase: "experiment-ref phase savedGroups",
  grp_exp_prereq: "experiment-ref phase prerequisite condition",
  grp_visual_phase: "visual experiment phase savedGroups",
  grp_holdout_condition: "holdout experiment phase condition",
  grp_holdout_phase: "holdout experiment phase savedGroups",
  grp_cb_condition: "contextual bandit condition",
  grp_cb_phase: "contextual bandit savedGroups",
  grp_cb_prereq: "contextual bandit prerequisite condition",
  grp_ramp_step:
    "monitored ramp step savedGroups patch, applied to the running rollout rule",
  grp_age_list: "number-typed ID list",
  grp_operator_list: "stored $savedGroups operator inside a rule condition",
  grp_none_condition: "condition group matched with none",
};

function listGroup(id: string, attributeKey: string, values: string[]) {
  return {
    id,
    organization: ORG_ID,
    groupName: id,
    owner: "",
    type: "list",
    attributeKey,
    values,
    useEmptyListGroup: true,
    dateCreated: NOW,
    dateUpdated: NOW,
  };
}

function conditionGroup(id: string, condition: Record<string, unknown>) {
  return {
    id,
    organization: ORG_ID,
    groupName: id,
    owner: "",
    type: "condition",
    condition: JSON.stringify(condition),
    dateCreated: NOW,
    dateUpdated: NOW,
  };
}

const savedGroups = [
  conditionGroup("grp_chain_1", { $savedGroups: ["grp_chain_2"] }),
  conditionGroup("grp_chain_2", { $savedGroups: ["grp_chain_3"] }),
  conditionGroup("grp_chain_3", { id: { $inGroup: "grp_chain_list" } }),
  listGroup("grp_chain_list", "id", ["chain-user-1", "chain-user-2"]),
  listGroup("grp_rule_list", "id", ["rule-list-user-1"]),
  listGroup("grp_feature_prereq_list", "id", ["feature-prereq-user-1"]),
  listGroup("grp_rule_prereq_list", "id", ["rule-prereq-user-1"]),
  listGroup("grp_exp_condition", "id", ["exp-condition-user-1"]),
  listGroup("grp_exp_phase", "id", ["exp-phase-user-1"]),
  listGroup("grp_exp_prereq", "id", ["exp-prereq-user-1"]),
  listGroup("grp_visual_phase", "id", ["visual-phase-user-1"]),
  listGroup("grp_holdout_condition", "country", ["HO"]),
  listGroup("grp_holdout_phase", "id", ["holdout-phase-user-1"]),
  listGroup("grp_cb_condition", "country", ["CB"]),
  listGroup("grp_cb_phase", "id", ["cb-phase-user-1"]),
  listGroup("grp_cb_prereq", "id", ["cb-prereq-user-1"]),
  listGroup("grp_ramp_step", "id", ["ramp-step-user-1"]),
  listGroup("grp_age_list", "age", ["18", "21", "65"]),
  listGroup("grp_operator_list", "id", ["operator-user-1"]),
  conditionGroup("grp_none_condition", { country: { $in: ["CA", "MX"] } }),
  // Never referenced: must reach no payload and no query.
  listGroup(
    "grp_huge",
    "id",
    Array.from({ length: HUGE_VALUE_COUNT }, (_, i) => `huge-user-${i}`),
  ),
  conditionGroup("grp_unused_condition", { $savedGroups: ["grp_huge"] }),
];

const prerequisite = (groupCondition: Record<string, unknown>) => ({
  id: "flag_parent",
  condition: JSON.stringify({ value: groupCondition }),
});

function feature(
  id: string,
  rules: Record<string, unknown>[],
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    organization: ORG_ID,
    owner: "",
    description: "",
    project: "",
    valueType: "boolean",
    defaultValue: "false",
    version: 1,
    archived: false,
    tags: [],
    prerequisites: [],
    environmentSettings: { production: { enabled: true } },
    rules: rules.map((rule, i) => ({
      id: `${id}_rule_${i}`,
      description: "",
      enabled: true,
      allEnvironments: true,
      ...rule,
    })),
    dateCreated: NOW,
    dateUpdated: NOW,
    ...extra,
  };
}

const force = (targeting: Record<string, unknown>) => ({
  type: "force",
  value: "true",
  ...targeting,
});

const features = [
  // Has a rule, so prerequisites pointing at it stay conditional and are
  // served as parentConditions instead of being folded at build time.
  feature("flag_parent", [
    force({ value: "false", condition: JSON.stringify({ country: "FR" }) }),
  ]),
  feature("flag_chain", [
    force({ savedGroups: [{ match: "all", ids: ["grp_chain_1"] }] }),
  ]),
  feature("flag_rule_list", [
    force({ savedGroups: [{ match: "any", ids: ["grp_rule_list"] }] }),
  ]),
  feature("flag_feature_prereq", [], {
    prerequisites: [prerequisite({ $inGroup: "grp_feature_prereq_list" })],
  }),
  feature("flag_rule_prereq", [
    force({
      prerequisites: [prerequisite({ $notInGroup: "grp_rule_prereq_list" })],
    }),
  ]),
  feature("flag_exp_ref", [
    {
      type: "experiment-ref",
      experimentId: "exp_ref",
      variations: [
        { variationId: "v0", value: "false" },
        { variationId: "v1", value: "true" },
      ],
    },
  ]),
  feature(
    "flag_holdout",
    [force({ condition: JSON.stringify({ country: "US" }) })],
    {
      holdout: { id: "hld_1", value: "false" },
    },
  ),
  feature("flag_cb", [
    {
      type: "contextual-bandit-ref",
      contextualBanditId: "cb_1",
      variations: [
        { variationId: "v0", value: "false" },
        { variationId: "v1", value: "true" },
      ],
    },
  ]),
  feature("flag_ramp", [
    {
      id: "fr_ramp",
      type: "rollout",
      value: "true",
      coverage: 0.2,
      hashAttribute: "id",
      seed: "fr_ramp",
      hashVersion: 2,
      savedGroups: [{ match: "all", ids: ["grp_ramp_step"] }],
    },
  ]),
  feature("flag_number", [
    force({ condition: JSON.stringify({ age: { $inGroup: "grp_age_list" } }) }),
  ]),
  feature("flag_operator", [
    force({
      condition: JSON.stringify({
        $savedGroups: ["grp_operator_list"],
        country: "DE",
      }),
    }),
  ]),
  feature("flag_none", [
    force({ savedGroups: [{ match: "none", ids: ["grp_none_condition"] }] }),
  ]),
];

function experiment(
  id: string,
  phase: Record<string, unknown>,
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    organization: ORG_ID,
    project: "",
    trackingKey: id,
    name: id,
    type: "standard",
    hypothesis: "",
    description: "",
    tags: [],
    owner: "",
    status: "running",
    archived: false,
    hashAttribute: "id",
    hashVersion: 2,
    variations: [
      { id: "v0", key: "0", name: "Control", description: "", screenshots: [] },
      {
        id: "v1",
        key: "1",
        name: "Variation",
        description: "",
        screenshots: [],
      },
    ],
    phases: [
      {
        name: "Main",
        reason: "",
        dateStarted: NOW,
        coverage: 1,
        condition: "",
        savedGroups: [],
        prerequisites: [],
        variationWeights: [0.5, 0.5],
        seed: id,
        variations: [],
        ...phase,
      },
    ],
    goalMetrics: [],
    secondaryMetrics: [],
    guardrailMetrics: [],
    linkedFeatures: [],
    hasVisualChangesets: false,
    hasURLRedirects: false,
    excludeFromPayload: false,
    customFields: {},
    dateCreated: NOW,
    dateUpdated: NOW,
    ...extra,
  };
}

const experiments = [
  experiment(
    "exp_ref",
    {
      condition: JSON.stringify({
        $or: [
          { country: "US" },
          { $not: { id: { $notInGroup: "grp_exp_condition" } } },
        ],
      }),
      savedGroups: [{ match: "all", ids: ["grp_exp_phase"] }],
      prerequisites: [prerequisite({ $inGroup: "grp_exp_prereq" })],
    },
    { linkedFeatures: ["flag_exp_ref"] },
  ),
  experiment(
    "exp_visual",
    { savedGroups: [{ match: "any", ids: ["grp_visual_phase"] }] },
    { hasVisualChangesets: true },
  ),
  // Shaped like services/holdouts.ts createHoldout: no linked changes, so it
  // is not a payload experiment; getAllPayloadHoldouts loads it by id.
  experiment(
    "exp_holdout",
    {
      coverage: 0.1,
      condition: JSON.stringify({
        country: { $inGroup: "grp_holdout_condition" },
      }),
      savedGroups: [{ match: "all", ids: ["grp_holdout_phase"] }],
    },
    { type: "holdout", trackingKey: "hld_1", excludeFromPayload: true },
  ),
];

const visualChangeset = {
  id: "vc_1",
  organization: ORG_ID,
  experiment: "exp_visual",
  editorUrl: "https://example.com/",
  urlPatterns: [
    { include: true, type: "simple", pattern: "https://example.com/" },
  ],
  visualChanges: [
    {
      id: "vch_1",
      variation: "v1",
      description: "",
      css: ".hero { display: none }",
      js: "",
      domMutations: [],
    },
  ],
};

const holdout = {
  id: "hld_1",
  organization: ORG_ID,
  name: "Holdout",
  projects: [],
  experimentId: "exp_holdout",
  linkedExperiments: {},
  linkedFeatures: { flag_holdout: { id: "flag_holdout", dateAdded: NOW } },
  environmentSettings: { production: { enabled: true } },
  dateCreated: NOW,
  dateUpdated: NOW,
};

const contextualBandit = {
  id: "cb_1",
  organization: ORG_ID,
  dateCreated: NOW,
  dateUpdated: NOW,
  name: "Checkout layout",
  description: "",
  project: "",
  owner: "",
  tags: [],
  archived: false,
  status: "running",
  trackingKey: "cb_1",
  hashAttribute: "id",
  variations: [
    { id: "v0", key: "0", name: "Control", screenshots: [] },
    { id: "v1", key: "1", name: "Treatment", screenshots: [] },
  ],
  datasource: "",
  contextualBanditQueryId: "",
  coverage: 1,
  condition: JSON.stringify({ country: { $inGroup: "grp_cb_condition" } }),
  savedGroups: [{ match: "all", ids: ["grp_cb_phase"] }],
  prerequisites: [prerequisite({ $inGroup: "grp_cb_prereq" })],
  seed: "cb_1",
  variationWeights: [
    { variationId: "v0", weight: 0.5 },
    { variationId: "v1", weight: 0.5 },
  ],
  currentLeafWeights: [],
  banditVersion: 0,
  contextualAttributes: ["country"],
  minUsersPerLeaf: 100,
  maxLeaves: 12,
  holdoutPercent: 0,
  banditModelVersion: 1,
  linkedFeatures: ["flag_cb"],
};

// Running at its first, monitored step. The step's patch is what the ramp
// engine wrote into `fr_ramp` at fire time (services/rampSchedule.ts
// applyPatchToRule -> publishRevision); the payload reads the rule.
const rampSchedule = {
  id: "rs_1",
  organization: ORG_ID,
  name: "Ramp",
  entityType: "feature",
  entityId: "flag_ramp",
  targets: [
    {
      id: "rt_1",
      entityType: "feature",
      entityId: "flag_ramp",
      ruleId: "fr_ramp",
      status: "active",
    },
  ],
  steps: [
    {
      interval: 3600,
      monitored: true,
      actions: [
        {
          targetType: "feature-rule",
          targetId: "fr_ramp",
          patch: {
            ruleId: "fr_ramp",
            coverage: 0.2,
            savedGroups: [{ match: "all", ids: ["grp_ramp_step"] }],
          },
        },
      ],
    },
  ],
  status: "running",
  currentStepIndex: 0,
  nextStepAt: null,
  dateCreated: NOW,
  dateUpdated: NOW,
};

const SDK_VERSION = getLatestSDKVersion("javascript");
const capabilities = getSDKCapabilities("javascript", SDK_VERSION);
const FORMATS: SavedGroupFormat[] = ["inline", "referencesV1", "referencesV2"];

type Payload = Record<string, unknown>;
type Built = { payload: Payload; requested: Set<string> };

// How the builder gets its saved groups: as production does now (scoped), as
// it did before (every group in the org, up front), or as before minus one
// group, to measure what that group contributes to the payload.
type Loader = "scoped" | "all" | { allWithout: string };

let context: ApiReqContext;

// What an SDK receives; `dateUpdated` is the build time.
const normalize = (defs: unknown): Payload =>
  JSON.parse(JSON.stringify({ ...(defs as Payload), dateUpdated: undefined }));

// Runs `build` with the payload builders' saved-group loader swapped for
// `loader`, and reports every id the loader was asked for.
async function withLoader<T>(
  loader: Loader,
  build: () => Promise<T>,
): Promise<{ result: T; requested: Set<string> }> {
  const model = context.models.savedGroups;
  // Spied on the prototype: it also reaches the background context the cache
  // refresh creates, and importing the class at runtime would close an import
  // cycle through services/context before the class is initialized.
  const prototype: SavedGroupModel = Object.getPrototypeOf(model);
  const spy = jest.spyOn(prototype, "getByIdsWithValues");
  // The full set is handed over on the loader's first round, so the build sees
  // what getAll() used to give it. A build that never asks would get nothing,
  // and an empty baseline would make parity trivial.
  let served = loader === "scoped";
  if (loader !== "scoped") {
    const dropped = loader === "all" ? null : loader.allWithout;
    spy.mockImplementation(async () => {
      if (served) return [];
      served = true;
      return (await model.getAll()).filter((group) => group.id !== dropped);
    });
  }
  try {
    const result = await build();
    if (!served) throw new Error("The payload build never loaded saved groups");
    return {
      result,
      requested: new Set(spy.mock.calls.flatMap(([ids]) => ids)),
    };
  } finally {
    spy.mockRestore();
  }
}

async function buildPayload(
  savedGroupFormat: SavedGroupFormat,
  loader: Loader,
): Promise<Built> {
  const { result, requested } = await withLoader(loader, () =>
    getFeatureDefinitions({
      context,
      capabilities,
      environment: "production",
      projects: [],
      savedGroupFormat,
      includeVisualExperiments: true,
      includeRedirectExperiments: true,
      includeExperimentNames: true,
      includeRuleIds: true,
    }),
  );
  return { payload: normalize(result), requested };
}

// The same connection options as buildPayload, as an SDK connection.
const connectionFor = (savedGroupFormat: SavedGroupFormat) =>
  ({
    id: `sdk_${savedGroupFormat}`,
    key: `sdk-${savedGroupFormat}`,
    organization: ORG_ID,
    name: savedGroupFormat,
    languages: ["javascript"],
    sdkVersion: SDK_VERSION,
    environment: "production",
    projects: [],
    encryptPayload: false,
    encryptionKey: "",
    includeVisualExperiments: true,
    includeRedirectExperiments: true,
    includeExperimentNames: true,
    includeRuleIds: true,
    savedGroupFormat,
    connected: true,
    proxy: { enabled: false, host: "", signingKey: "", connected: false },
    dateCreated: NOW,
    dateUpdated: NOW,
  }) as unknown as SDKConnectionInterface;

// Refreshes one connection per format through the bulk builder and reads the
// payloads back from the cache it wrote.
async function refreshPayloads(
  loader: Loader,
): Promise<Record<SavedGroupFormat, Payload>> {
  // The refresh swallows a failed connection build and leaves that connection's
  // old cache entry in place; start empty so only this refresh's payloads can
  // be read back.
  await mongoose.connection.db!.collection("sdkcache").deleteMany({});
  await withLoader(loader, () =>
    refreshSDKPayloadCache({
      context,
      payloadKeys: [],
      sdkConnections: FORMATS.map(connectionFor),
    }),
  );
  const payloads = {} as Record<SavedGroupFormat, Payload>;
  for (const format of FORMATS) {
    const cached = await context.models.sdkConnectionCache.getById(
      connectionFor(format).key,
    );
    if (!cached) throw new Error(`No cached payload for ${format}`);
    payloads[format] = normalize(JSON.parse(cached.contents));
  }
  return payloads;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

// One line per differing payload entry, so a failure names the feature,
// experiment or saved-group entry that changed.
function payloadDiff(before: Payload, after: Payload): string[] {
  const lines: string[] = [];
  for (const section of new Set([
    ...Object.keys(before),
    ...Object.keys(after),
  ])) {
    const b = before[section];
    const a = after[section];
    if (isEqual(a, b)) continue;
    if (isRecord(a) && isRecord(b)) {
      for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
        if (!isEqual(b[key], a[key])) {
          lines.push(
            `${section}.${key}: ${JSON.stringify(b[key])} -> ${JSON.stringify(a[key])}`,
          );
        }
      }
    } else {
      lines.push(`${section}: ${JSON.stringify(b)} -> ${JSON.stringify(a)}`);
    }
  }
  return lines;
}

const rulesOf = (payload: Payload, featureId: string) =>
  (payload.features as Record<string, { rules?: Record<string, unknown>[] }>)[
    featureId
  ]?.rules ?? [];

beforeAll(async () => {
  await connectTestMongo();
  const db = mongoose.connection.db!;
  await db.collection("savedgroups").insertMany(savedGroups);
  await db.collection("features").insertMany(features);
  await db.collection("experiments").insertMany(experiments);
  await db.collection("visualchangesets").insertOne(visualChangeset);
  await db.collection("holdouts").insertOne(holdout);
  await db.collection("contextualbandits").insertOne(contextualBandit);
  await db.collection("rampschedules").insertOne(rampSchedule);
  context = getContextForAgendaJobByOrgObject(org);
});

afterAll(async () => {
  await waitForIndexes();
  await disconnectTestMongo();
});

describe("fixture", () => {
  let all: Payload;
  beforeAll(async () => {
    all = (await buildPayload("inline", "all")).payload;
  });

  it("stores a group for every canary", () => {
    const stored = new Set(savedGroups.map((group) => group.id));
    expect(Object.keys(CANARIES).filter((id) => !stored.has(id))).toEqual([]);
  });

  // Each canary must reach the payload through the path named for it; a
  // canary that fell back to a plainer path would still be load-bearing while
  // proving nothing about that path.
  it("renders every canary through the path it is meant to exercise", () => {
    expect(rulesOf(all, "flag_ramp")[0]).toMatchObject({ key: "ramp_rs_1" });
    expect(rulesOf(all, "flag_cb")[0]).toMatchObject({
      contextualBanditRef: "cb_1",
      parentConditions: [{ id: "flag_parent" }],
    });
    expect(rulesOf(all, "flag_holdout")[0]).toMatchObject({
      parentConditions: [{ id: "$holdout:hld_1" }],
    });
    expect(rulesOf(all, "$holdout:hld_1")[0]).toMatchObject({ key: "hld_1" });
    expect(rulesOf(all, "flag_exp_ref")[0]).toMatchObject({
      key: "exp_ref",
      parentConditions: [{ id: "flag_parent" }],
    });
    expect(rulesOf(all, "flag_feature_prereq")[0]).toMatchObject({
      parentConditions: [{ id: "flag_parent", gate: true }],
    });
    expect(rulesOf(all, "flag_rule_prereq")[0]).toMatchObject({
      parentConditions: [{ id: "flag_parent" }],
    });
    expect(all.experiments).toMatchObject([{ key: "exp_visual" }]);
  });
});

describe.each(FORMATS)("%s connection", (savedGroupFormat) => {
  let all: Built;
  let scoped: Built;

  beforeAll(async () => {
    all = await buildPayload(savedGroupFormat, "all");
    scoped = await buildPayload(savedGroupFormat, "scoped");
  });

  it("serves the same payload from the referenced groups as from every group", () => {
    expect(payloadDiff(all.payload, scoped.payload)).toEqual([]);
  });

  // The formats must not collapse into one another, or this column of the
  // matrix would silently repeat another.
  it("writes conditions with this format's operator", () => {
    const operators = {
      inline: '"$in"',
      referencesV1: '"$inGroup"',
      referencesV2: '"$savedGroup"',
    };
    const condition =
      JSON.stringify(rulesOf(all.payload, "flag_number")[0]?.condition) ?? "";
    for (const [format, operator] of Object.entries(operators)) {
      expect(condition.includes(operator)).toBe(format === savedGroupFormat);
    }
  });

  it("loads every referenced group and nothing else", () => {
    expect([...scoped.requested].filter((id) => !(id in CANARIES))).toEqual([]);
    expect(
      Object.keys(CANARIES).filter((id) => !scoped.requested.has(id)),
    ).toEqual([]);
    for (const built of [all, scoped]) {
      expect(JSON.stringify(built.payload)).not.toMatch(/grp_huge|huge-user-/);
    }
  });

  // Sensitivity: the parity assertion above only guards a group whose
  // absence changes the payload. Drop each canary from the full set and
  // require a difference. Measured against the full set, not the scoped one,
  // so an inert canary cannot hide behind one the scoped build misses.
  it("changes the payload when any one canary is not loaded", async () => {
    const inert: string[] = [];
    for (const id of Object.keys(CANARIES)) {
      const degraded = await buildPayload(savedGroupFormat, { allWithout: id });
      if (!payloadDiff(all.payload, degraded.payload).length) {
        inert.push(`${id}: ${CANARIES[id]}`);
      }
    }
    expect(inert).toEqual([]);
  });
});

// The bulk builder behind the cache: its own loads, the same collector.
describe("refreshSDKPayloadCache", () => {
  let all: Record<SavedGroupFormat, Payload>;
  let scoped: Record<SavedGroupFormat, Payload>;

  beforeAll(async () => {
    all = await refreshPayloads("all");
    scoped = await refreshPayloads("scoped");
  });

  it.each(FORMATS)(
    "%s connection caches the same payload from the referenced groups as from every group",
    (savedGroupFormat) => {
      expect(
        payloadDiff(all[savedGroupFormat], scoped[savedGroupFormat]),
      ).toEqual([]);
    },
  );

  it.each(FORMATS)(
    "%s connection caches what getFeatureDefinitions serves",
    async (savedGroupFormat) => {
      const direct = await buildPayload(savedGroupFormat, "scoped");
      expect(payloadDiff(direct.payload, scoped[savedGroupFormat])).toEqual([]);
    },
  );
});
