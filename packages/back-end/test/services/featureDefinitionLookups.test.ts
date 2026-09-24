import { FeatureInterface } from "shared/types/feature";
import { OrganizationInterface } from "shared/types/organization";
import { ExperimentInterface } from "shared/types/experiment";
import { SafeRolloutInterface } from "shared/types/safe-rollout";
import { SavedGroupInterface } from "shared/types/saved-group";
import { FeatureRevisionInterface } from "shared/types/feature-revision";
import { MAX_SAVED_GROUP_DEPTH } from "shared/sdk-versioning";
import {
  getApiFeatureObj,
  getApiFeatureObjV2,
  getFeatureDefinitionLookups,
  getSavedGroupMap,
} from "back-end/src/services/features";
import { ApiReqContext } from "back-end/types/api";

// The REST feature reads load only the Saved Groups and Safe Rollouts the
// features' definitions can look up, and the groups without their ID lists.
// These tests pin that the narrowed maps produce exactly what the
// organization-wide maps produce.

const organization = {
  id: "org_test",
  settings: {
    environments: [{ id: "production" }, { id: "dev" }],
    attributeSchema: [
      { property: "id", datatype: "string" },
      { property: "account", datatype: "number" },
      { property: "country", datatype: "string" },
    ],
  },
} as unknown as OrganizationInterface;

const group = (
  id: string,
  partial: Partial<SavedGroupInterface>,
): SavedGroupInterface =>
  ({
    id,
    organization: "org_test",
    groupName: id,
    owner: "",
    dateCreated: new Date("2024-01-01"),
    dateUpdated: new Date("2024-01-01"),
    type: "list",
    attributeKey: "id",
    values: ["u1", "u2"],
    ...partial,
  }) as SavedGroupInterface;

const allGroups: SavedGroupInterface[] = [
  group("grp_list", { values: ["u1", "u2", "u3"] }),
  group("grp_numbers", { attributeKey: "account", values: ["10", "20"] }),
  group("grp_empty", { values: [] }),
  group("grp_empty_allowed", { values: [], useEmptyListGroup: true }),
  group("grp_cond_top", {
    type: "condition",
    attributeKey: undefined,
    values: undefined,
    condition: '{"country":"US","$savedGroups":["grp_cond_mid"]}',
  }),
  group("grp_cond_mid", {
    type: "condition",
    attributeKey: undefined,
    values: undefined,
    condition: '{"$savedGroups":["grp_leaf"]}',
  }),
  group("grp_leaf", { values: ["leaf1"] }),
  group("grp_phase", { values: ["p1", "p2"] }),
  group("grp_phase_cond", {
    type: "condition",
    attributeKey: undefined,
    values: undefined,
    condition: '{"country":"CA"}',
  }),
  group("grp_draft", { values: ["d1"] }),
  group("grp_prereq", {
    type: "condition",
    attributeKey: undefined,
    values: undefined,
    condition: '{"value":true}',
  }),
  group("grp_rule_prereq", {
    type: "condition",
    attributeKey: undefined,
    values: undefined,
    condition: '{"value":{"$ne":false}}',
  }),
  // Reached only through an object-valued `$inGroup`, from a rule and from a group.
  group("grp_in_object", {
    type: "condition",
    attributeKey: undefined,
    values: undefined,
    condition:
      '{"id":{"$notInGroup":{"$savedGroups":["grp_in_object_inner"]}}}',
  }),
  group("grp_in_object_inner", { values: ["inner1"] }),
  // References a group that no longer exists.
  group("grp_dangling", {
    type: "condition",
    attributeKey: undefined,
    values: undefined,
    condition: '{"$savedGroups":["grp_deleted_nested"]}',
  }),
  group("grp_old_phase", { values: ["old1"] }),
  // grp_chain_0 -> grp_chain_1 -> ... -> grp_chain_14 (a list)
  ...Array.from({ length: 14 }, (_, i) =>
    group(`grp_chain_${i}`, {
      type: "condition",
      attributeKey: undefined,
      values: undefined,
      condition: JSON.stringify({ $savedGroups: [`grp_chain_${i + 1}`] }),
    }),
  ),
  group("grp_chain_14", { values: ["end"] }),
  ...Array.from({ length: 25 }, (_, i) =>
    group(`grp_unused_${i}`, { values: ["x", "y", "z"] }),
  ),
];

const safeRollout = (id: string, step: number): SafeRolloutInterface =>
  ({
    id,
    organization: "org_test",
    featureId: "feat_lookup",
    rampUpSchedule: {
      enabled: true,
      rampUpCompleted: false,
      step,
      steps: [{ percent: 0.1 }, { percent: 0.25 }, { percent: 0.5 }],
    },
  }) as unknown as SafeRolloutInterface;

const allSafeRollouts = [
  safeRollout("sr_live", 1),
  safeRollout("sr_draft", 2),
  safeRollout("sr_unused", 0),
];

const experiment = {
  id: "exp_1",
  organization: "org_test",
  trackingKey: "exp-1",
  name: "Experiment",
  status: "running",
  archived: false,
  hashAttribute: "id",
  hashVersion: 2,
  linkedFeatures: ["feat_lookup"],
  variations: [
    { id: "v0", key: "0", name: "Control" },
    { id: "v1", key: "1", name: "Variation" },
  ],
  phases: [
    {
      name: "Earlier",
      dateStarted: new Date("2023-12-01"),
      dateEnded: new Date("2024-01-01"),
      coverage: 1,
      variationWeights: [0.5, 0.5],
      condition: "{}",
      savedGroups: [{ match: "all", ids: ["grp_old_phase"] }],
      seed: "seed",
      namespace: { enabled: false, name: "", range: [0, 1] },
    },
    {
      name: "Main",
      dateStarted: new Date("2024-01-01"),
      coverage: 1,
      variationWeights: [0.5, 0.5],
      condition: '{"$savedGroups":["grp_phase_cond"]}',
      savedGroups: [{ match: "any", ids: ["grp_phase"] }],
      seed: "seed",
      namespace: { enabled: false, name: "", range: [0, 1] },
    },
  ],
} as unknown as ExperimentInterface;
const experimentMap = new Map([[experiment.id, experiment]]);

const base = { description: "", enabled: true, allEnvironments: true };
const feature = {
  id: "feat_lookup",
  organization: "org_test",
  owner: "tester",
  dateCreated: new Date("2024-01-01"),
  dateUpdated: new Date("2024-01-01"),
  valueType: "boolean",
  defaultValue: "false",
  version: 3,
  tags: [],
  project: "",
  environmentSettings: {
    production: { enabled: true },
    dev: { enabled: true },
  },
  prerequisites: [
    { id: "parent_flag", condition: '{"$savedGroups":["grp_prereq"]}' },
  ],
  rules: [
    {
      ...base,
      id: "fr_all",
      type: "force",
      value: "true",
      savedGroups: [
        {
          match: "all",
          ids: ["grp_list", "grp_empty", "grp_empty_allowed"],
        },
      ],
    },
    {
      ...base,
      id: "fr_none",
      type: "force",
      value: "true",
      savedGroups: [{ match: "none", ids: ["grp_numbers"] }],
    },
    {
      ...base,
      id: "fr_nested",
      type: "rollout",
      value: "true",
      coverage: 0.5,
      hashAttribute: "id",
      condition: '{"$savedGroups":["grp_cond_top"]}',
    },
    {
      ...base,
      id: "fr_exp",
      type: "experiment-ref",
      experimentId: "exp_1",
      variations: [
        { variationId: "v0", value: "false" },
        { variationId: "v1", value: "true" },
      ],
    },
    {
      ...base,
      id: "fr_operators",
      type: "force",
      value: "true",
      condition: JSON.stringify({
        $or: [
          { id: { $inGroup: { $savedGroups: ["grp_in_object"] } } },
          { $not: { $savedGroups: "grp_phase_cond" } },
        ],
      }),
      prerequisites: [
        {
          id: "parent_flag",
          condition: '{"$savedGroups":["grp_rule_prereq"]}',
        },
      ],
    },
    {
      ...base,
      id: "fr_via_targeting",
      type: "force",
      value: "true",
      // A condition group reached through `savedGroups` targeting, then nested.
      savedGroups: [{ match: "none", ids: ["grp_cond_top"] }],
    },
    {
      ...base,
      id: "fr_deleted",
      type: "force",
      value: "true",
      savedGroups: [{ match: "any", ids: ["grp_deleted", "grp_dangling"] }],
    },
    {
      ...base,
      id: "fr_disabled_malformed",
      type: "force",
      value: "true",
      enabled: false,
      savedGroups: [
        { match: "all", ids: [null, "grp_list"] },
        { match: "all" },
      ],
    },
    {
      ...base,
      id: "fr_safe_gone",
      type: "safe-rollout",
      safeRolloutId: "sr_deleted",
      status: "running",
      controlValue: "false",
      variationValue: "true",
      hashAttribute: "id",
      seed: "sr-seed-3",
      trackingKey: "sr-gone",
    },
    {
      ...base,
      id: "fr_safe",
      type: "safe-rollout",
      safeRolloutId: "sr_live",
      status: "running",
      controlValue: "false",
      variationValue: "true",
      hashAttribute: "id",
      seed: "sr-seed",
      trackingKey: "sr-live",
      savedGroups: [{ match: "any", ids: ["grp_leaf"] }],
    },
  ],
} as unknown as FeatureInterface;

const revisions = [
  {
    featureId: "feat_lookup",
    organization: "org_test",
    version: 4,
    baseVersion: 3,
    status: "draft",
    comment: "",
    dateCreated: new Date("2024-02-01"),
    dateUpdated: new Date("2024-02-01"),
    datePublished: null,
    createdBy: { type: "api_key", apiKey: "" },
    publishedBy: null,
    defaultValue: "false",
    rules: [
      {
        ...base,
        id: "fr_draft",
        type: "force",
        value: "true",
        savedGroups: [{ match: "all", ids: ["grp_draft"] }],
      },
      {
        ...base,
        id: "fr_safe_draft",
        type: "safe-rollout",
        safeRolloutId: "sr_draft",
        status: "running",
        controlValue: "false",
        variationValue: "true",
        hashAttribute: "id",
        seed: "sr-seed-2",
        trackingKey: "sr-draft",
      },
    ],
  },
] as unknown as FeatureRevisionInterface[];

function makeContext() {
  // As strict as BaseModel.getByIds.
  const assertIds = (ids: string[]) => {
    if (!Array.isArray(ids) || !ids.every((id) => typeof id === "string")) {
      throw new Error("Invalid ids");
    }
  };
  // As SavedGroupModel.getMetadata.
  const groupMetadata = jest.fn(async (ids: string[]) => {
    assertIds(ids);
    return allGroups
      .filter((g) => ids.includes(g.id))
      .map(({ values, ...g }) => ({ ...g, hasValues: !!values?.length }));
  });
  const safeRolloutsByIds = jest.fn(async (ids: string[]) => {
    assertIds(ids);
    return allSafeRollouts.filter((r) => ids.includes(r.id));
  });
  const getAll = jest.fn(async () => allGroups);
  const context = {
    org: organization,
    models: {
      savedGroups: { getMetadata: groupMetadata, getAll },
      safeRollout: { getByIds: safeRolloutsByIds },
    },
  } as unknown as ApiReqContext;
  return { context, safeRolloutsByIds, getAll };
}

const chainFeature = (entry: "targeting" | "condition", start: number) =>
  ({
    ...feature,
    prerequisites: [],
    rules: [
      {
        ...base,
        id: "fr_chain",
        type: "force",
        value: "true",
        ...(entry === "targeting"
          ? { savedGroups: [{ match: "all", ids: [`grp_chain_${start}`] }] }
          : { condition: `{"$savedGroups":["grp_chain_${start}"]}` }),
      },
    ],
  }) as unknown as FeatureInterface;

describe("getFeatureDefinitionLookups", () => {
  // grp_chain_<start> is (14 - start) condition groups above the list at the end.
  it.each([
    ["targeting", 14 - (MAX_SAVED_GROUP_DEPTH - 1)],
    ["targeting", 14 - MAX_SAVED_GROUP_DEPTH],
    ["targeting", 14 - (MAX_SAVED_GROUP_DEPTH + 1)],
    ["condition", 14 - (MAX_SAVED_GROUP_DEPTH - 1)],
    ["condition", 14 - MAX_SAVED_GROUP_DEPTH],
    ["condition", 14 - (MAX_SAVED_GROUP_DEPTH + 1)],
  ] as const)(
    "matches the organization-wide maps across the nesting limit (%s, from grp_chain_%i)",
    async (entry, start) => {
      const { context } = makeContext();
      const deep = chainFeature(entry, start);
      const args = {
        feature: deep,
        organization,
        experimentMap: new Map<string, ExperimentInterface>(),
        revision: null,
      };
      const full = getApiFeatureObj({
        ...args,
        groupMap: await getSavedGroupMap(context, allGroups),
        safeRolloutMap: new Map(),
      });
      const narrowed = await getFeatureDefinitionLookups(context, {
        features: [deep],
      });
      expect(getApiFeatureObj({ ...args, ...narrowed })).toEqual(full);
      // Either the list at the end is reached, or expansion gave up: never a
      // group that the narrowed map failed to load.
      expect(full.environments.production.definition).toMatch(
        /grp_chain_14|__sgMaxDepth__/,
      );
      expect(full.environments.production.definition).not.toContain(
        "__sgUnknown__",
      );
    },
  );

  it("loads only what the feature, its revisions and its experiments reference", async () => {
    const { context, safeRolloutsByIds, getAll } = makeContext();

    const { groupMap, safeRolloutMap } = await getFeatureDefinitionLookups(
      context,
      {
        features: [feature],
        revisions,
        experiments: [...experimentMap.values()],
      },
    );

    expect([...groupMap.keys()].sort()).toEqual([
      "grp_cond_mid",
      "grp_cond_top",
      "grp_dangling",
      "grp_draft",
      "grp_empty",
      "grp_empty_allowed",
      "grp_in_object",
      "grp_in_object_inner",
      "grp_leaf",
      "grp_list",
      "grp_numbers",
      "grp_old_phase",
      "grp_phase",
      "grp_phase_cond",
      "grp_prereq",
      "grp_rule_prereq",
    ]);
    expect([...safeRolloutMap.keys()].sort()).toEqual(["sr_draft", "sr_live"]);
    expect(getAll).not.toHaveBeenCalled();
    expect(safeRolloutsByIds).toHaveBeenCalledTimes(1);
    // No ID lists, only whether each one has values.
    expect(groupMap.get("grp_numbers")).not.toHaveProperty("values");
    expect(groupMap.get("grp_numbers")?.hasValues).toBe(true);
    expect(groupMap.get("grp_empty")?.hasValues).toBe(false);
  });

  it("builds the same v1 and v2 API objects as the organization-wide maps", async () => {
    const { context } = makeContext();
    const fullGroupMap = await getSavedGroupMap(context, allGroups);
    const fullSafeRolloutMap = new Map(allSafeRollouts.map((r) => [r.id, r]));
    const narrowed = await getFeatureDefinitionLookups(context, {
      features: [feature],
      revisions,
      experiments: [...experimentMap.values()],
    });

    const common = { feature, organization, experimentMap, revision: null };
    const fullV1 = getApiFeatureObj({
      ...common,
      revisions,
      groupMap: fullGroupMap,
      safeRolloutMap: fullSafeRolloutMap,
    });
    expect(getApiFeatureObj({ ...common, revisions, ...narrowed })).toEqual(
      fullV1,
    );
    // v2 compiles no definitions for revisions, so its handler passes none.
    const narrowedV2 = await getFeatureDefinitionLookups(context, {
      features: [feature],
      experiments: [...experimentMap.values()],
    });
    expect(getApiFeatureObjV2({ ...common, revisions, ...narrowedV2 })).toEqual(
      getApiFeatureObjV2({
        ...common,
        revisions,
        groupMap: fullGroupMap,
        safeRolloutMap: fullSafeRolloutMap,
      }),
    );

    // The fixture really exercises the lookups: every group kind and both safe
    // rollouts show up in the compiled definitions, and empty maps differ.
    const production = fullV1.environments.production.definition ?? "";
    expect(production).toContain('"$inGroup":"grp_list"');
    expect(production).toContain('"$notInGroup":"grp_numbers"');
    expect(production).toContain('"$inGroup":"grp_leaf"');
    expect(production).toContain('"$inGroup":"grp_phase"');
    expect(production).toContain('"country":"CA"');
    expect(production).toContain('"coverage":0.25');
    expect(production).not.toContain('"grp_empty"');
    expect(production).toContain('"$inGroup":"grp_empty_allowed"');
    // Object-valued `$inGroup`, resolved two groups deep.
    expect(production).toContain(
      '"$inGroup":{"id":{"$notInGroup":{"id":{"$inGroup":"grp_in_object_inner"}}}}',
    );
    expect(production).toContain('"value":{"$ne":false}');
    expect(production).toContain('"__sgUnknown__":"grp_deleted_nested"');
    expect(production).not.toContain("grp_old_phase");
    const draft = fullV1.revisions?.[0]?.definitions?.production ?? "";
    expect(draft).toContain('"$inGroup":"grp_draft"');
    expect(draft).toContain('"coverage":0.5');
  });
});
