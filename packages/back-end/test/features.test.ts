import cloneDeep from "lodash/cloneDeep";
import {
  getAffectedSDKPayloadKeys,
  getEnabledEnvironments,
  getFeatureDefinition,
  getJSONValue,
  getParsedCondition,
  getSDKPayloadKeysByDiff,
  replaceSavedGroupsInCondition,
  roundVariationWeight,
} from "../src/util/features";
import { getCurrentEnabledState } from "../src/util/scheduleRules";
import { FeatureInterface, ScheduleRule } from "../types/feature";
import { hashStrings } from "../src/services/features";
import { SDKAttributeSchema } from "../types/organization";
import { ExperimentInterface } from "../types/experiment";
import { GroupMap } from "../types/saved-group";

const groupMap: GroupMap = new Map();
const experimentMap = new Map();

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

describe("getParsedCondition", () => {
  it("compiles correctly", () => {
    groupMap.clear();
    groupMap.set("a", { values: ["0", "1"], key: "id_a", source: "inline" });
    groupMap.set("b", { values: ["2"], key: "id_b", source: "inline" });
    groupMap.set("c", { values: ["3"], key: "id_c", source: "inline" });
    groupMap.set("d", { values: ["4"], key: "id_d", source: "inline" });
    groupMap.set("e", { values: ["5"], key: "id_e", source: "inline" });
    groupMap.set("f", { values: ["6"], key: "id_f", source: "inline" });
    groupMap.set("empty", { values: [], key: "empty", source: "inline" });

    // No condition or saved group
    expect(getParsedCondition(groupMap, "", [])).toBeUndefined();

    // Single empty saved group
    expect(
      getParsedCondition(groupMap, "", [{ match: "any", ids: ["empty"] }])
    ).toBeUndefined();

    // No saved groups
    expect(
      getParsedCondition(groupMap, JSON.stringify({ country: "US" }), [])
    ).toEqual({ country: "US" });

    // Saved group in condition
    expect(
      getParsedCondition(
        groupMap,
        JSON.stringify({ id: { $inGroup: "a" } }),
        []
      )
    ).toEqual({
      id: { $in: ["0", "1"] },
    });

    // Single saved group
    expect(
      getParsedCondition(groupMap, "", [{ match: "any", ids: ["a"] }])
    ).toEqual({
      id_a: {
        $in: ["0", "1"],
      },
    });

    // Only 1 valid saved group
    expect(
      getParsedCondition(groupMap, "", [
        { match: "any", ids: ["b", "empty", "g"] },
        { match: "all", ids: ["g", "empty"] },
      ])
    ).toEqual({
      id_b: { $in: ["2"] },
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
      ])
    ).toEqual({
      $and: [
        // Attribute targeting
        { country: "US" },
        // ALL
        {
          id_a: {
            $in: ["0", "1"],
          },
        },
        {
          id_b: {
            $in: ["2"],
          },
        },
        // ANY
        {
          $or: [
            {
              id_c: {
                $in: ["3"],
              },
            },
            {
              id_d: {
                $in: ["4"],
              },
            },
          ],
        },
        // NONE
        {
          id_e: {
            $nin: ["5"],
          },
        },
        {
          id_f: {
            $nin: ["6"],
          },
        },
      ],
    });

    groupMap.clear();
  });

  it("works with runtime groups", () => {
    groupMap.clear();
    groupMap.set("a", { values: [], key: "group_a", source: "runtime" });
    groupMap.set("b", { values: [], key: "group_b", source: "runtime" });

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
      ])
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
});

describe("replaceSavedGroupsInCondition", () => {
  it("does not format condition that doesn't contain $inGroup", () => {
    const rawCondition = JSON.stringify({ id: "1234" });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      JSON.stringify({ id: "1234" })
    );
  });

  it("replaces the $inGroup and groupId with $in and the array of IDs", () => {
    const ids = ["123", "345", "678", "910"];
    const groupId = "grp_exl5jgrdl8bzy4x4";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    const rawCondition = JSON.stringify({ id: { $inGroup: groupId } });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"id":{"$in": ["123","345","678","910"]}}'
    );
  });

  it("replaces the $notInGroup and groupId with $nin and the array of IDs", () => {
    const ids = ["123", "345", "678", "910"];
    const groupId = "grp_exl5jgrdl8bzy4x4";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    const rawCondition = JSON.stringify({ id: { $notInGroup: groupId } });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"id":{"$nin": ["123","345","678","910"]}}'
    );
  });

  it("should replace the $in operator in and if the group.attributeKey is a number, the output array should be numbers", () => {
    const ids = [1, 2, 3, 4];
    const groupId = "grp_exl5jijgl8c3n0qt";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    const rawCondition = JSON.stringify({ number: { $inGroup: groupId } });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"number":{"$in": [1,2,3,4]}}'
    );
  });

  it("should replace the $in operator in more complex conditions correctly", () => {
    const ids = [1, 2, 3, 4];
    const groupId = "grp_exl5jijgl8c3n0qt";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    const rawCondition = JSON.stringify({
      number: { $inGroup: groupId },
      id: "123",
      browser: "chrome",
    });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"number":{"$in": [1,2,3,4]},"id":"123","browser":"chrome"}'
    );
  });

  it("should correctly replace the $in operator in advanced mode conditions", () => {
    const ids = [1, 2, 3, 4];
    const groupId = "grp_exl5jijgl8c3n0qt";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    const rawCondition = JSON.stringify({
      $and: [
        {
          $or: [{ browser: "chrome" }, { deviceId: { $inGroup: groupId } }],
        },
        {
          $not: [{ company: { $notInGroup: groupId } }],
        },
      ],
    });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"$and":[{"$or":[{"browser":"chrome"},{"deviceId":{"$in": [1,2,3,4]}}]},{"$not":[{"company":{"$nin": [1,2,3,4]}}]}]}'
    );
  });

  it("handle extra whitespace and spaces correctly", () => {
    const ids = ["123", "345", "678", "910"];
    const groupId = "grp_exl5jgrdl8bzy4x4";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    /* eslint-disable */
    const rawCondition =
      '{"id":{   "$inGroup"           :            "grp_exl5jgrdl8bzy4x4"   }}';
    /* eslint-enable */

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"id":{"$in": ["123","345","678","910"]}}'
    );
  });

  it("handle extra newlines and spaces correctly", () => {
    const ids = ["123", "345", "678", "910"];
    const groupId = "grp_exl5jgrdl8bzy4x4";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    /* eslint-disable */
    const rawCondition = `{"id":{"$notInGroup"
       :
             "grp_exl5jgrdl8bzy4x4"
    }}`;
    /* eslint-enable */

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"id":{"$nin": ["123","345","678","910"]}}'
    );
  });

  it("should replace the $in operator and add an empty array if groupId doesn't exist", () => {
    const ids = ["1", "2", "3", "4"];
    const groupId = "grp_exl5jijgl8c3n0qt";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    const rawCondition = JSON.stringify({
      number: { $inGroup: "invalid-groupId" },
    });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"number":{"$in": []}}'
    );
  });

  it("should NOT replace $inGroup text if it appears in a string somewhere randomly", () => {
    const ids = ["1", "2", "3", "4"];
    const groupId = "grp_exl5jijgl8c3n0qt";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    const rawCondition = JSON.stringify({
      number: { $eq: "$inGroup" },
    });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"number":{"$eq":"$inGroup"}}'
    );
  });

  it("should NOT replace someone hand writes a condition with $inGroup: false", () => {
    const ids = ["1", "2", "3", "4"];
    const groupId = "grp_exl5jijgl8c3n0qt";
    groupMap.set(groupId, { values: ids, key: "id", source: "inline" });

    const rawCondition = JSON.stringify({
      number: { $inGroup: false },
    });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"number":{"$inGroup":false}}'
    );
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
          $eq:
            "855279ed7f7f86a26b1c9f6a5c827b35728638219b0dae61db6b0578d8e21360",
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
                id:
                  "29532748527922fa2c4b8b02388d1fe3dedc42c86ba021265cfc693c622c0ad3",
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
      true
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
      getEnabledEnvironments(feature, ["dev", "production", "test"])
    ).toEqual(new Set(["dev", "production"]));

    expect(getEnabledEnvironments(feature, ["dev", "test"])).toEqual(
      new Set(["dev"])
    );

    expect(
      getEnabledEnvironments(
        feature,
        ["dev", "production", "test"],
        (rule) => rule.type === "force" && rule.value === "true"
      )
    ).toEqual(new Set(["dev"]));

    expect(
      getEnabledEnvironments(
        feature,
        ["dev", "production", "test"],
        (rule) => rule.type === "force" && rule.value === "false"
      )
    ).toEqual(new Set(["production"]));

    feature.environmentSettings.dev.enabled = false;
    expect(
      getEnabledEnvironments(feature, ["dev", "production", "test"])
    ).toEqual(new Set(["production"]));

    expect(
      getEnabledEnvironments(
        feature,
        ["dev", "production", "test"],
        (rule) => rule.type === "force" && rule.value === "true"
      )
    ).toEqual(new Set([]));
  });

  it("Gets Affected SDK Payload Keys", () => {
    const feature1 = cloneDeep(baseFeature);
    const feature2 = cloneDeep(baseFeature);
    const changedFeatures = [feature1, feature2];

    expect(
      getAffectedSDKPayloadKeys(changedFeatures, ["dev", "production", "test"])
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
      getAffectedSDKPayloadKeys(changedFeatures, ["dev", "production", "test"])
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
      ])
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
      ])
    ).toEqual([]);

    expect(
      getSDKPayloadKeysByDiff(
        feature,
        {
          ...updatedFeature,
          defaultValue: "false",
        },
        ["dev", "production", "test"]
      )
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
        ["dev", "production", "test"]
      )
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
        ["dev", "production", "test"]
      )
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
        ["dev", "production", "test"]
      )
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
      ])
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
      ["dev", "production", "test"]
    )
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
    ])
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
    const experimentMap = new Map([["exp_123", exp]]);

    // Includes the experiment
    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        experimentMap: experimentMap,
      })
    ).toEqual({
      defaultValue: true,
      rules: [
        {
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
      })
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
      })
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
      })
    ).toEqual({
      defaultValue: true,
      rules: [
        {
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
      })
    ).toEqual({
      defaultValue: true,
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
      })
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
      })
    ).toEqual(null);

    expect(
      getFeatureDefinition({
        feature,
        environment: "unknown",
        groupMap: groupMap,
        experimentMap: experimentMap,
      })
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
      })
    ).toEqual({
      defaultValue: true,
      rules: [
        {
          condition: {
            country: "US",
          },
          force: false,
        },
        {
          coverage: 0.8,
          force: false,
          hashAttribute: "id",
        },
        {
          coverage: 1,
          hashAttribute: "anonymous_id",
          variations: [true, false],
          meta: [{ key: "0" }, { key: "1" }],
          weights: [0.7, 0.3],
          key: "testing",
        },
      ],
    });
  });
});
