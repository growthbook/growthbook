import cloneDeep from "lodash/cloneDeep";
import { GroupMap, SavedGroupInterface } from "shared/types/groups";
import { FeatureDefinitionWithProject } from "shared/types/sdk";
import {
  getAffectedSDKPayloadKeys,
  getEnabledEnvironments,
  getFeatureDefinition,
  getJSONValue,
  getParsedCondition,
  getSDKPayloadKeysByDiff,
  roundVariationWeight,
} from "back-end/src/util/features";
import { getCurrentEnabledState } from "back-end/src/util/scheduleRules";
import { FeatureInterface, ScheduleRule } from "back-end/types/feature";
import {
  getFeatureDefinitionsResponse,
  hashStrings,
  sha256,
} from "back-end/src/services/features";
import {
  OrganizationInterface,
  SDKAttribute,
  SDKAttributeSchema,
} from "back-end/types/organization";
import { ExperimentInterface } from "back-end/types/experiment";
import { SafeRolloutInterface } from "../types/safe-rollout";

const groupMap: GroupMap = new Map();
const experimentMap = new Map();
const safeRolloutMap = new Map();
const baseFeature: FeatureInterface = {
  id: "feature",
  dateCreated: new Date(),
  dateUpdated: new Date(),
  defaultValue: "true",
  organization: "123",
  owner: "",
  valueType: "boolean" as const,
  archived: false,
  description: "",
  version: 1,
  environmentSettings: {
    dev: {
      enabled: true,
      rules: [],
    },
    production: {
      enabled: true,
      rules: [],
    },
  },
};

const baseOrganization: OrganizationInterface = {
  id: "123",
  url: "foo",
  dateCreated: new Date(),
  name: "",
  ownerEmail: "",
  members: [],
  invites: [],
};

describe("getParsedCondition", () => {
  it("compiles correctly", () => {
    groupMap.clear();
    groupMap.set("a", {
      type: "list",
      values: ["0", "1"],
      attributeKey: "id_a",
    });
    groupMap.set("b", {
      type: "list",
      values: ["2"],
      attributeKey: "id_b",
    });
    groupMap.set("c", {
      type: "list",
      values: ["3"],
      attributeKey: "id_c",
    });
    groupMap.set("d", {
      type: "list",
      values: ["4"],
      attributeKey: "id_d",
    });
    groupMap.set("e", {
      type: "list",
      values: ["5"],
      attributeKey: "id_e",
    });
    groupMap.set("f", {
      type: "list",
      values: ["6"],
      attributeKey: "id_f",
    });
    groupMap.set("empty", {
      type: "list",
      values: [],
      attributeKey: "empty",
    });
    groupMap.set("legacy", {
      type: "list",
      values: ["0", "1"],
      attributeKey: "id_a",
    });

    // No condition or saved group
    expect(getParsedCondition(groupMap, "", [])).toBeUndefined();

    // Single empty saved group
    expect(
      getParsedCondition(groupMap, "", [{ match: "any", ids: ["empty"] }]),
    ).toBeUndefined();

    // No saved groups
    expect(
      getParsedCondition(groupMap, JSON.stringify({ country: "US" }), []),
    ).toEqual({ country: "US" });

    // Saved group in condition
    expect(
      getParsedCondition(
        groupMap,
        JSON.stringify({ id: { $inGroup: "a" } }),
        [],
      ),
    ).toEqual({
      id: { $inGroup: "a" },
    });

    // Single saved group
    expect(
      getParsedCondition(groupMap, "", [{ match: "any", ids: ["a"] }]),
    ).toEqual({
      id_a: {
        $inGroup: "a",
      },
    });

    // Legacy saved group still uses inGroup operator (to be scrubbed later)
    expect(
      getParsedCondition(groupMap, "", [{ match: "any", ids: ["legacy"] }]),
    ).toEqual({
      id_a: {
        $inGroup: "legacy",
      },
    });

    // Only 1 valid saved group
    expect(
      getParsedCondition(groupMap, "", [
        { match: "any", ids: ["b", "empty", "g"] },
        { match: "all", ids: ["g", "empty"] },
      ]),
    ).toEqual({
      id_b: { $inGroup: "b" },
    });

    // Condition + a bunch of saved groups
    expect(
      getParsedCondition(groupMap, JSON.stringify({ country: "US" }), [
        {
          match: "all",
          ids: ["a", "b", "x"],
        },
        {
          match: "any",
          ids: ["c", "d"],
        },
        {
          match: "none",
          ids: ["e", "f"],
        },
      ]),
    ).toEqual({
      $and: [
        // Attribute targeting
        { country: "US" },
        // ALL
        {
          id_a: {
            $inGroup: "a",
          },
        },
        {
          id_b: {
            $inGroup: "b",
          },
        },
        // ANY
        {
          $or: [
            {
              id_c: {
                $inGroup: "c",
              },
            },
            {
              id_d: {
                $inGroup: "d",
              },
            },
          ],
        },
        // NONE
        {
          id_e: {
            $notInGroup: "e",
          },
        },
        {
          id_f: {
            $notInGroup: "f",
          },
        },
      ],
    });

    groupMap.clear();
  });

  it("ignores empty condition groups", () => {
    groupMap.clear();
    groupMap.set("a", {
      condition: "{}",
      type: "condition",
    });
    groupMap.set("b", {
      condition: "",
      type: "condition",
    });
    groupMap.set("c", {
      type: "condition",
    });
    groupMap.set("d", {
      condition: "{broken",
      type: "condition",
    });
    groupMap.set("e", {
      type: "list",
    });
    groupMap.set("f", {
      type: "list",
      attributeKey: "a",
    });
    groupMap.set("g", {
      type: "list",
      attributeKey: "",
      values: ["a"],
    });
    groupMap.set("h", {
      condition: JSON.stringify({ id: 1 }),
      type: "condition",
    });

    expect(
      getParsedCondition(groupMap, "", [
        {
          match: "all",
          ids: ["a", "b", "c", "d", "e", "f", "g", "h"],
        },
        {
          match: "any",
          ids: ["a", "b", "c", "d", "e", "f", "g"],
        },
        {
          match: "none",
          ids: ["a", "b", "c", "d", "e", "f", "g"],
        },
      ]),
    ).toEqual({
      id: 1,
    });

    expect(
      getParsedCondition(groupMap, "", [
        {
          match: "all",
          ids: ["a", "b", "c", "d", "e", "f", "g"],
        },
        {
          match: "any",
          ids: ["a", "b", "c", "d", "e", "f", "g"],
        },
        {
          match: "none",
          ids: ["a", "b", "c", "d", "e", "f", "g"],
        },
      ]),
    ).toEqual(undefined);

    groupMap.clear();
  });

  it("includes empty list groups only when the flag is set", () => {
    groupMap.clear();
    groupMap.set("a", {
      values: [],
      type: "list",
      attributeKey: "attr",
      useEmptyListGroup: true,
    });
    groupMap.set("b", {
      values: [],
      type: "list",
      attributeKey: "attr",
    });

    expect(
      getParsedCondition(groupMap, "", [{ match: "all", ids: ["a", "b"] }]),
    ).toEqual({
      attr: {
        $inGroup: "a",
      },
    });

    expect(
      getParsedCondition(groupMap, "", [{ match: "none", ids: ["a", "b"] }]),
    ).toEqual({
      attr: {
        $notInGroup: "a",
      },
    });
    groupMap.clear();
  });

  it("works with condition groups", () => {
    groupMap.clear();
    groupMap.set("a", {
      condition: JSON.stringify({
        $groups: {
          $elemMatch: { $eq: "group_a" },
        },
      }),
      type: "condition",
    });
    groupMap.set("b", {
      condition: JSON.stringify({
        $groups: {
          $elemMatch: { $eq: "group_b" },
        },
      }),
      type: "condition",
    });

    expect(
      getParsedCondition(groupMap, "", [
        {
          match: "all",
          ids: ["a", "b"],
        },
        {
          match: "any",
          ids: ["a", "b"],
        },
        {
          match: "none",
          ids: ["a", "b"],
        },
      ]),
    ).toEqual({
      $and: [
        {
          $groups: {
            $elemMatch: { $eq: "group_a" },
          },
        },
        {
          $groups: {
            $elemMatch: { $eq: "group_b" },
          },
        },
        {
          $or: [
            {
              $groups: {
                $elemMatch: { $eq: "group_a" },
              },
            },
            {
              $groups: {
                $elemMatch: { $eq: "group_b" },
              },
            },
          ],
        },
        {
          $not: {
            $groups: {
              $elemMatch: { $eq: "group_a" },
            },
          },
        },
        {
          $not: {
            $groups: {
              $elemMatch: { $eq: "group_b" },
            },
          },
        },
      ],
    });

    groupMap.clear();
  });

  it("works with nested condition groups", () => {
    groupMap.clear();
    groupMap.set("a", {
      type: "condition",
      condition: JSON.stringify({
        foo: "bar",
        $savedGroups: ["b"],
      }),
    });
    groupMap.set("b", {
      type: "condition",
      condition: JSON.stringify({
        bar: "baz",
        $savedGroups: ["c"],
      }),
    });
    groupMap.set("c", {
      type: "condition",
      condition: JSON.stringify({
        baz: "foo",
      }),
    });

    expect(
      getParsedCondition(
        groupMap,
        JSON.stringify({
          country: "US",
        }),
        [
          {
            match: "all",
            ids: ["a"],
          },
        ],
      ),
    ).toEqual({
      $and: [
        {
          country: "US",
        },
        {
          foo: "bar",
          bar: "baz",
          baz: "foo",
        },
      ],
    });
  });
});

describe("Hashing secureString types", () => {
  const attributes: SDKAttributeSchema = [
    { property: "id", datatype: "secureString" },
    { property: "company", datatype: "string" },
    { property: "ids", datatype: "secureString[]" },
    { property: "email", datatype: "string" },
    { property: "whatever", datatype: "number" },
  ];

  const secureAttributeSalt = "fa37ffz";

  it("should selectively hash secureString types for simple conditions", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let condition: any = {
      ids: {
        $elemMatch: {
          $eq: "5",
        },
      },
      id: {
        $in: ["3", "5", "10"],
        $ne: "5",
      },
      company: "AcmeCo",
    };

    condition = hashStrings({
      obj: condition,
      salt: secureAttributeSalt,
      attributes,
    });

    expect(condition).toEqual({
      ids: {
        $elemMatch: {
          $eq: "855279ed7f7f86a26b1c9f6a5c827b35728638219b0dae61db6b0578d8e21360",
        },
      },
      id: {
        $in: [
          "5ec1a7686c15f1fef131baea7d59acf29f2623d50dbad079a2685e19158ad494",
          "855279ed7f7f86a26b1c9f6a5c827b35728638219b0dae61db6b0578d8e21360",
          "cfec6b2485875c0172509320a1076d9d91cc9fd7fb70ed4d2d4c62d29b1a9ce3",
        ],
        $ne: "855279ed7f7f86a26b1c9f6a5c827b35728638219b0dae61db6b0578d8e21360",
      },
      company: "AcmeCo",
    });
  });

  it("should selectively match secureString types for advanced nested conditions", () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let condition: any = {
      $or: [
        {
          $and: [
            {
              $not: {
                email: "test@example.com",
              },
            },
            {
              $not: {
                id: "4",
              },
            },
          ],
        },
        {
          id: {
            $in: ["3"],
          },
        },
        {
          company: "AcmeCo",
        },
        {
          whatever: "1",
        },
        {
          id: ["3", "5", "10"],
        },
      ],
      id: {
        $not: {
          $elemMatch: {
            $in: ["b", "c", "d"],
          },
        },
      },
    };

    condition = hashStrings({
      obj: condition,
      salt: secureAttributeSalt,
      attributes,
    });

    expect(condition).toEqual({
      $or: [
        {
          $and: [
            {
              $not: {
                email: "test@example.com",
              },
            },
            {
              $not: {
                id: "29532748527922fa2c4b8b02388d1fe3dedc42c86ba021265cfc693c622c0ad3",
              },
            },
          ],
        },
        {
          id: {
            $in: [
              "5ec1a7686c15f1fef131baea7d59acf29f2623d50dbad079a2685e19158ad494",
            ],
          },
        },
        {
          company: "AcmeCo",
        },
        {
          whatever: "1",
        },
        {
          id: [
            "5ec1a7686c15f1fef131baea7d59acf29f2623d50dbad079a2685e19158ad494",
            "855279ed7f7f86a26b1c9f6a5c827b35728638219b0dae61db6b0578d8e21360",
            "cfec6b2485875c0172509320a1076d9d91cc9fd7fb70ed4d2d4c62d29b1a9ce3",
          ],
        },
      ],
      id: {
        $not: {
          $elemMatch: {
            $in: [
              "4d07b4e570f0e719baa23054c01a49eabfe55952c2161c28b73d1f98cfdc4991",
              "b1f66640509e58acb4b99afd32ecf51d1b8e61d577b909d2e7a3d2a48a53ed51",
              "374877627d479396ae4c4bae9bf06fe1f0db9d6571ddb23479a2ff76ff925c0f",
            ],
          },
        },
      },
    });
  });
});

describe("Scheduled Rules", () => {
  it("should not filter out features that have no scheduled rules calling getFeatureDefinition", () => {
    const scheduleRules = undefined;

    expect(getCurrentEnabledState(scheduleRules || [], new Date())).toEqual(
      true,
    );
  });

  it("should filter out a feature that has an upcoming schedule rule with enabled = true", () => {
    const scheduleRules: ScheduleRule[] = [
      { enabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
      { enabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
    ];

    const date = new Date("2022-11-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
  });

  it("should NOT filter out a feature that has an upcoming schedule rule with enabled = false", () => {
    const scheduleRules: ScheduleRule[] = [
      { enabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
      { enabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
    ];

    const date = new Date("2022-12-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);
  });

  it("should filter out a feature that has no upcoming rules and the last schedule rule to run had enabled = false", () => {
    const scheduleRules: ScheduleRule[] = [
      { enabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
      { enabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
    ];

    const date = new Date("2023-01-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
  });

  it("should NOT filter out a feature that has no upcoming schedule rules and the last schedule rule to run had enabled = true", () => {
    const scheduleRules: ScheduleRule[] = [
      { enabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
      { enabled: false, timestamp: null },
    ];

    const date = new Date("2023-01-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);
  });

  it("should filter out feature if upcoming schedule rule is in the future and enabled is true", () => {
    const scheduleRules: ScheduleRule[] = [
      { enabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
      { enabled: false, timestamp: null },
    ];

    const date = new Date("2022-11-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
  });

  it("should NOT filter out a feature if upcoming schedule rule is in the future and enabled is false", () => {
    const scheduleRules: ScheduleRule[] = [
      { enabled: true, timestamp: null },
      { enabled: false, timestamp: "2022-12-30T13:00:00.000Z" },
    ];

    const date = new Date("2022-12-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);
  });

  it("should filter out feature if no upcoming schedule rule and last schedule rule had enabled = false", () => {
    const scheduleRules: ScheduleRule[] = [
      { enabled: true, timestamp: null },
      { enabled: false, timestamp: "2022-12-30T13:00:00.000Z" },
    ];

    const date = new Date("2023-01-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
  });

  it("should handle dates that are out of chronological order", () => {
    let scheduleRules: ScheduleRule[] = [
      { enabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
      { enabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
    ];

    let date = new Date("2022-12-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);

    scheduleRules = [
      { enabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
      { enabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
    ];

    date = new Date("2023-01-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);

    scheduleRules = [
      { enabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
      { enabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
    ];

    date = new Date("2022-11-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
  });

  it("should handle more than 2 scheduleRules correctly, even when they are out of chronological order", () => {
    // NOTE: Currently, a user can only have 2 schedule rules, a startDate and an endDate, but this was built in a way where
    // in the future, we can support multiple start/stop dates.
    const scheduleRules: ScheduleRule[] = [
      { enabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
      { enabled: false, timestamp: null },
      { enabled: true, timestamp: "2023-01-05T12:00:00.000Z" },
      { enabled: true, timestamp: null },
    ];

    const date = new Date("2022-11-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);
  });

  it("should handle more than 2 scheduleRules correctly", () => {
    const scheduleRules: ScheduleRule[] = [
      { enabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
      { enabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
      { enabled: true, timestamp: "2023-01-05T12:00:00.000Z" },
      { enabled: false, timestamp: "2023-01-30T12:00:00.000Z" },
    ];

    let date = new Date("2022-11-15T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);

    date = new Date("2022-12-05T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);

    date = new Date("2023-01-02T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);

    date = new Date("2023-01-10T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);

    date = new Date("2023-02-01T12:00:00.000Z");

    expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
  });
});

describe("Detecting Feature Changes", () => {
  it("Gets enabled environments", () => {
    const feature = cloneDeep(baseFeature);
    feature.environmentSettings.dev.rules = [
      {
        enabled: true,
        type: "force",
        description: "",
        id: "",
        value: "true",
      },
    ];
    feature.environmentSettings.production.rules = [
      {
        enabled: true,
        type: "force",
        description: "",
        id: "",
        value: "false",
      },
    ];

    expect(
      getEnabledEnvironments(feature, ["dev", "production", "test"]),
    ).toEqual(new Set(["dev", "production"]));

    expect(getEnabledEnvironments(feature, ["dev", "test"])).toEqual(
      new Set(["dev"]),
    );

    expect(
      getEnabledEnvironments(
        feature,
        ["dev", "production", "test"],
        (rule) => rule.type === "force" && rule.value === "true",
      ),
    ).toEqual(new Set(["dev"]));

    expect(
      getEnabledEnvironments(
        feature,
        ["dev", "production", "test"],
        (rule) => rule.type === "force" && rule.value === "false",
      ),
    ).toEqual(new Set(["production"]));

    feature.environmentSettings.dev.enabled = false;
    expect(
      getEnabledEnvironments(feature, ["dev", "production", "test"]),
    ).toEqual(new Set(["production"]));

    expect(
      getEnabledEnvironments(
        feature,
        ["dev", "production", "test"],
        (rule) => rule.type === "force" && rule.value === "true",
      ),
    ).toEqual(new Set([]));
  });

  it("Gets Affected SDK Payload Keys", () => {
    const feature1 = cloneDeep(baseFeature);
    const feature2 = cloneDeep(baseFeature);
    const changedFeatures = [feature1, feature2];

    expect(
      getAffectedSDKPayloadKeys(changedFeatures, ["dev", "production", "test"]),
    ).toEqual([
      {
        project: "",
        environment: "dev",
      },
      {
        project: "",
        environment: "production",
      },
    ]);

    // Give the features different projects and env enabled states
    feature1.project = "p1";
    feature1.environmentSettings.dev.enabled = false;

    feature2.project = "p2";
    feature2.environmentSettings.production.enabled = false;

    expect(
      getAffectedSDKPayloadKeys(changedFeatures, ["dev", "production", "test"]),
    ).toEqual([
      {
        project: "",
        environment: "production",
      },
      {
        project: "p1",
        environment: "production",
      },
      {
        project: "",
        environment: "dev",
      },
      {
        project: "p2",
        environment: "dev",
      },
    ]);
  });

  it("Detects which projects/environments are affected by a feature change", () => {
    const feature = cloneDeep(baseFeature);
    const updatedFeature = cloneDeep(baseFeature);

    expect(
      getSDKPayloadKeysByDiff(feature, updatedFeature, [
        "dev",
        "production",
        "test",
      ]),
    ).toEqual([]);

    updatedFeature.description = "New description";
    updatedFeature.owner = "new owner";
    updatedFeature.tags = ["a"];
    updatedFeature.dateUpdated = new Date();

    expect(
      getSDKPayloadKeysByDiff(feature, updatedFeature, [
        "dev",
        "production",
        "test",
      ]),
    ).toEqual([]);

    expect(
      getSDKPayloadKeysByDiff(
        feature,
        {
          ...updatedFeature,
          defaultValue: "false",
        },
        ["dev", "production", "test"],
      ),
    ).toEqual([
      {
        project: "",
        environment: "dev",
      },
      {
        project: "",
        environment: "production",
      },
    ]);
    expect(
      getSDKPayloadKeysByDiff(
        feature,
        {
          ...updatedFeature,
          archived: true,
        },
        ["dev", "production", "test"],
      ),
    ).toEqual([
      {
        project: "",
        environment: "dev",
      },
      {
        project: "",
        environment: "production",
      },
    ]);
    expect(
      getSDKPayloadKeysByDiff(
        feature,
        {
          ...updatedFeature,
          nextScheduledUpdate: new Date(),
        },
        ["dev", "production", "test"],
      ),
    ).toEqual([
      {
        project: "",
        environment: "dev",
      },
      {
        project: "",
        environment: "production",
      },
    ]);
    expect(
      getSDKPayloadKeysByDiff(
        feature,
        {
          ...updatedFeature,
          project: "p2",
        },
        ["dev", "production", "test"],
      ),
    ).toEqual([
      {
        project: "",
        environment: "dev",
      },
      {
        project: "p2",
        environment: "dev",
      },
      {
        project: "",
        environment: "production",
      },
      {
        project: "p2",
        environment: "production",
      },
    ]);

    updatedFeature.environmentSettings.dev.enabled = false;
    expect(
      getSDKPayloadKeysByDiff(feature, updatedFeature, [
        "dev",
        "production",
        "test",
      ]),
    ).toEqual([
      {
        project: "",
        environment: "dev",
      },
    ]);
  });
});

describe("Changes are ignored when archived or disabled", () => {
  const feature = cloneDeep(baseFeature);
  const updatedFeature = cloneDeep(baseFeature);

  // Ignore changes when archived before and after
  expect(
    getSDKPayloadKeysByDiff(
      {
        ...feature,
        archived: true,
      },
      {
        ...updatedFeature,
        archived: true,
        project: "43280943fjdskalfja",
      },
      ["dev", "production", "test"],
    ),
  ).toEqual([]);

  // Ignore environment changes if it's disabled before and after
  feature.environmentSettings.dev.enabled = false;
  updatedFeature.environmentSettings.dev.enabled = false;
  updatedFeature.environmentSettings.dev.rules = [
    {
      type: "force",
      description: "",
      id: "",
      value: "true",
    },
  ];
  expect(
    getSDKPayloadKeysByDiff(feature, updatedFeature, [
      "dev",
      "production",
      "test",
    ]),
  ).toEqual([]);
});

describe("SDK Payloads", () => {
  it("Rounds variation weights", () => {
    expect(roundVariationWeight(0.48675849)).toEqual(0.4868);
  });

  it("Gets JSON values", () => {
    expect(getJSONValue("boolean", "false")).toEqual(false);
    expect(getJSONValue("boolean", "true")).toEqual(true);
    expect(getJSONValue("boolean", "other")).toEqual(true);

    expect(getJSONValue("number", "123.53")).toEqual(123.53);
    expect(getJSONValue("number", "unknown")).toEqual(0);

    expect(getJSONValue("string", "foo")).toEqual("foo");
    expect(getJSONValue("string", "123")).toEqual("123");

    expect(getJSONValue("json", "invalid")).toEqual(null);
    expect(getJSONValue("json", '{"foo": 1}')).toEqual({ foo: 1 });
  });

  it("Uses linked experiments to build feature definitions", () => {
    const feature = cloneDeep(baseFeature);
    feature.environmentSettings["production"].rules = [
      {
        type: "experiment-ref",
        experimentId: "exp_123",
        description: "",
        id: "abc",
        enabled: true,
        variations: [
          {
            variationId: "v0",
            value: "false",
          },
          {
            variationId: "v1",
            value: "true",
          },
        ],
      },
    ];

    const exp: ExperimentInterface = {
      archived: false,
      autoAssign: false,
      implementation: "code",
      autoSnapshots: false,
      datasource: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      exposureQueryId: "",
      hashAttribute: "user_id",
      hashVersion: 2,
      id: "exp_123",
      metrics: [],
      name: "My Experiment",
      organization: "",
      owner: "",
      phases: [
        {
          condition: `{"country":"us"}`,
          coverage: 0.8,
          dateStarted: new Date(),
          name: "My Phase",
          namespace: {
            enabled: true,
            name: "namespace",
            range: [0, 0.6],
          },
          reason: "",
          variationWeights: [0.4, 0.6],
          seed: "testing",
        },
      ],
      previewURL: "",
      releasedVariationId: "",
      status: "running",
      tags: [],
      targetURLRegex: "",
      trackingKey: "exp-key",
      variations: [
        {
          id: "v0",
          key: "k0",
          name: "Control",
          screenshots: [],
        },
        {
          id: "v1",
          key: "k1",
          name: "Variation 1",
          screenshots: [],
        },
      ],
      linkedFeatures: ["feature"],
      excludeFromPayload: false,
    };
    const safeRollout: SafeRolloutInterface = {
      id: "sr_123",
      organization: "123",
      dateCreated: new Date(),
      dateUpdated: new Date(),
      featureId: "feature",
      environment: "production",
      datasourceId: "ds_123",
      exposureQueryId: "eq_123",
      guardrailMetricIds: [],
      maxDuration: {
        amount: 7,
        unit: "days",
      },
      autoRollback: true,
      status: "running",
      autoSnapshots: true,
      startedAt: new Date(),
      lastSnapshotAttempt: new Date(),
      nextSnapshotAttempt: new Date(),
      analysisSummary: undefined,
      pastNotifications: [],
      rampUpSchedule: {
        enabled: true,
        step: 1,
        steps: [0.1, 0.25, 0.5],
        rampUpCompleted: false,
      },
    };
    const experimentMap = new Map([["exp_123", exp]]);
    const safeRolloutMap = new Map([["sr_123", safeRollout]]);
    // Includes the experiment
    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
      rules: [
        {
          id: "abc",
          key: "exp-key",
          coverage: 0.8,
          hashAttribute: "user_id",
          hashVersion: 2,
          condition: {
            country: "us",
          },
          meta: [
            {
              key: "k0",
              name: "Control",
            },
            {
              key: "k1",
              name: "Variation 1",
            },
          ],
          name: "My Experiment",
          namespace: ["namespace", 0, 0.6],
          phase: "0",
          seed: "testing",
          variations: [false, true],
          weights: [0.4, 0.6],
        },
      ],
    });

    // Excludes because it's archived
    exp.archived = true;
    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
    });

    // Excludes because it's stopped without a released variation
    exp.archived = false;
    exp.status = "stopped";
    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
    });

    // Included with released variation id
    exp.releasedVariationId = "v1";
    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
      rules: [
        {
          id: "abc",
          coverage: 0.8,
          hashAttribute: "user_id",
          hashVersion: 2,
          condition: {
            country: "us",
          },
          namespace: ["namespace", 0, 0.6],
          seed: "testing",
          force: true,
        },
      ],
    });

    // Excluded because the experiment doesn't exist
    experimentMap.clear();
    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
    });
  });

  it("Uses safe rollouts to build feature definitions", () => {
    const feature = cloneDeep(baseFeature);
    feature.environmentSettings["production"].rules = [
      {
        type: "safe-rollout",
        controlValue: "false",
        variationValue: "true",
        safeRolloutId: "sr_123",
        status: "running",
        hashAttribute: "user_id",
        seed: "testing",
        trackingKey: "exp-key",
        description: "",
        id: "abc",
        enabled: true,
      },
    ];

    // Includes the running safe rollout as an experiment with the right preset coverage
    // and weights

    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
      project: undefined,
      rules: [
        {
          id: "abc",
          key: "exp-key",
          coverage: 1,
          hashAttribute: "user_id",
          hashVersion: 2,
          meta: [
            {
              key: "0",
              name: "Control",
            },
            {
              key: "1",
              name: "Variation",
            },
          ],
          name: "feature - Safe Rollout",
          phase: "0",
          seed: "testing",
          variations: [false, true],
          weights: [0.5, 0.5],
        },
      ],
    });

    const feature2 = cloneDeep(baseFeature);
    feature2.environmentSettings["production"].rules = [
      {
        type: "safe-rollout",
        controlValue: "false",
        variationValue: "true",
        safeRolloutId: "sr_123",
        status: "rolled-back",
        hashAttribute: "user_id",
        seed: "testing",
        trackingKey: "exp-key",
        description: "",
        id: "abc",
        enabled: true,
      },
    ];

    // Includes the rolled-back safe rollout as a force rule with the control value
    expect(
      getFeatureDefinition({
        feature: feature2,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
      project: undefined,
      rules: [
        {
          id: "abc",
          force: false,
        },
      ],
    });

    const feature3 = cloneDeep(baseFeature);
    feature3.environmentSettings["production"].rules = [
      {
        type: "safe-rollout",
        controlValue: "false",
        variationValue: "true",
        safeRolloutId: "sr_123",
        status: "released",
        hashAttribute: "user_id",
        seed: "testing",
        trackingKey: "exp-key",
        description: "",
        id: "abc",
        enabled: true,
      },
    ];

    // Includes the released safe rollout as a force rule with the variation value
    expect(
      getFeatureDefinition({
        feature: feature3,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
      project: undefined,
      rules: [
        {
          id: "abc",
          force: true,
        },
      ],
    });
  });

  it("Gets Feature Definitions", () => {
    const feature = cloneDeep(baseFeature);

    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
    });

    feature.environmentSettings.production.enabled = false;

    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual(null);

    expect(
      getFeatureDefinition({
        feature,
        environment: "unknown",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual(null);

    feature.environmentSettings.dev.rules = [
      {
        type: "force",
        description: "",
        id: "1",
        value: "false",
        condition: '{"country": "US"}',
        scheduleRules: [
          {
            enabled: true,
            timestamp: "2000-01-01T00:00:00Z",
          },
        ],
        enabled: true,
      },
      {
        type: "force",
        description: "",
        id: "skipped1",
        value: "false",
        enabled: false,
      },
      {
        type: "force",
        description: "",
        id: "skipped2",
        value: "false",
        scheduleRules: [
          {
            enabled: true,
            timestamp: "2199-01-01T00:00:00Z",
          },
        ],
        enabled: true,
      },
      {
        type: "rollout",
        description: "",
        id: "2",
        coverage: 0.8,
        hashAttribute: "id",
        value: "false",
        enabled: true,
      },
      {
        type: "experiment",
        description: "",
        id: "3",
        coverage: 1,
        hashAttribute: "anonymous_id",
        trackingKey: "testing",
        values: [
          {
            value: "true",
            weight: 0.7,
          },
          {
            value: "false",
            weight: 0.3,
          },
        ],
        enabled: true,
      },
    ];

    expect(
      getFeatureDefinition({
        feature,
        environment: "dev",
        groupMap: groupMap,
        experimentMap: experimentMap,
        safeRolloutMap: safeRolloutMap,
      }),
    ).toEqual({
      defaultValue: true,
      rules: [
        {
          condition: {
            country: "US",
          },
          force: false,
          id: "1",
        },
        {
          coverage: 0.8,
          force: false,
          hashAttribute: "id",
          id: "2",
        },
        {
          coverage: 1,
          hashAttribute: "anonymous_id",
          variations: [true, false],
          meta: [{ key: "0" }, { key: "1" }],
          weights: [0.7, 0.3],
          key: "testing",
          id: "3",
        },
      ],
    });
  });

  describe("Saved Groups", () => {
    const secureStringAttr: SDKAttribute = {
      property: "id",
      datatype: "secureString",
      hashAttribute: true,
    };
    const organization = cloneDeep(baseOrganization);
    organization.settings = {
      attributeSchema: [secureStringAttr],
    };
    const groupDef: SavedGroupInterface = {
      id: "groupId",
      type: "list",
      attributeKey: "id",
      values: ["1", "2", "3"],
      organization: "123",
      groupName: "",
      owner: "",
      dateCreated: new Date(),
      dateUpdated: new Date(),
    };
    const featureDef: FeatureDefinitionWithProject = {
      defaultValue: true,
      rules: [
        {
          id: "1",
          condition: {
            id: {
              $inGroup: "groupId",
            },
          },
          force: false,
        },
      ],
    };

    it("Hashes secure attributes in inline saved groups", async () => {
      const { features, savedGroups } = await getFeatureDefinitionsResponse({
        features: { featureName: cloneDeep(featureDef) },
        experiments: [],
        dateUpdated: new Date(),
        projects: [],
        capabilities: [],
        usedSavedGroups: [cloneDeep(groupDef)],
        organization: organization,
        attributes: [secureStringAttr],
        secureAttributeSalt: "salt",
        holdouts: {},
      });
      expect(features).toEqual({
        featureName: {
          defaultValue: true,
          rules: [
            {
              condition: {
                id: {
                  $in: ["1", "2", "3"].map((val) => sha256(val, "salt")),
                },
              },
              force: false,
            },
          ],
        },
      });
      expect(savedGroups).toEqual(undefined);
    });

    it("Hashes secure attributes in referenced saved groups", async () => {
      const { features, savedGroups } = await getFeatureDefinitionsResponse({
        features: { featureName: cloneDeep(featureDef) },
        experiments: [],
        dateUpdated: new Date(),
        projects: [],
        capabilities: ["savedGroupReferences"],
        savedGroupReferencesEnabled: true,
        usedSavedGroups: [cloneDeep(groupDef)],
        organization: organization,
        attributes: [secureStringAttr],
        secureAttributeSalt: "salt",
        holdouts: {},
      });
      expect(features).toEqual({
        featureName: {
          defaultValue: true,
          rules: [
            {
              condition: {
                id: {
                  $inGroup: "groupId",
                },
              },
              force: false,
            },
          ],
        },
      });
      expect(savedGroups).toEqual({
        groupId: ["1", "2", "3"].map((val) => sha256(val, "salt")),
      });
    });
  });
});
