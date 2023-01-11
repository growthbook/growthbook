import cloneDeep from "lodash/cloneDeep";
import {
  getAffectedSDKPayloadKeys,
  getEnabledEnvironments,
  getFeatureDefinition,
  getJSONValue,
  getSDKPayloadKeysByDiff,
  replaceSavedGroupsInCondition,
  roundVariationWeight,
} from "../src/util/features";
import { getCurrentEnabledState } from "../src/util/scheduleRules";
import { FeatureInterface, ScheduleRule } from "../types/feature";

const groupMap = new Map();

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
    groupMap.set(groupId, ids);

    const rawCondition = JSON.stringify({ id: { $inGroup: groupId } });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"id":{"$in": ["123","345","678","910"]}}'
    );
  });

  it("replaces the $notInGroup and groupId with $nin and the array of IDs", () => {
    const ids = ["123", "345", "678", "910"];
    const groupId = "grp_exl5jgrdl8bzy4x4";
    groupMap.set(groupId, ids);

    const rawCondition = JSON.stringify({ id: { $notInGroup: groupId } });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"id":{"$nin": ["123","345","678","910"]}}'
    );
  });

  it("should replace the $in operator in and if the group.attributeKey is a number, the output array should be numbers", () => {
    const ids = [1, 2, 3, 4];
    const groupId = "grp_exl5jijgl8c3n0qt";
    groupMap.set(groupId, ids);

    const rawCondition = JSON.stringify({ number: { $inGroup: groupId } });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"number":{"$in": [1,2,3,4]}}'
    );
  });

  it("should replace the $in operator in more complex conditions correctly", () => {
    const ids = [1, 2, 3, 4];
    const groupId = "grp_exl5jijgl8c3n0qt";
    groupMap.set(groupId, ids);

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
    groupMap.set(groupId, ids);

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
    groupMap.set(groupId, ids);

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
    groupMap.set(groupId, ids);

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
    groupMap.set(groupId, ids);

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
    groupMap.set(groupId, ids);

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
    groupMap.set(groupId, ids);

    const rawCondition = JSON.stringify({
      number: { $inGroup: false },
    });

    expect(replaceSavedGroupsInCondition(rawCondition, groupMap)).toEqual(
      '{"number":{"$inGroup":false}}'
    );
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

    expect(getEnabledEnvironments(feature)).toEqual(
      new Set(["dev", "production"])
    );

    expect(
      getEnabledEnvironments(
        feature,
        (rule) => rule.type === "force" && rule.value === "true"
      )
    ).toEqual(new Set(["dev"]));

    expect(
      getEnabledEnvironments(
        feature,
        (rule) => rule.type === "force" && rule.value === "false"
      )
    ).toEqual(new Set(["production"]));

    feature.environmentSettings.dev.enabled = false;
    expect(getEnabledEnvironments(feature)).toEqual(new Set(["production"]));

    expect(
      getEnabledEnvironments(
        feature,
        (rule) => rule.type === "force" && rule.value === "true"
      )
    ).toEqual(new Set([]));
  });

  it("Gets Affected SDK Payload Keys", () => {
    const feature1 = cloneDeep(baseFeature);
    const feature2 = cloneDeep(baseFeature);
    const changedFeatures = [feature1, feature2];

    expect(getAffectedSDKPayloadKeys(changedFeatures)).toEqual([
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

    expect(getAffectedSDKPayloadKeys(changedFeatures)).toEqual([
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

    expect(getSDKPayloadKeysByDiff(feature, updatedFeature)).toEqual([]);

    updatedFeature.description = "New description";
    updatedFeature.draft = {
      active: true,
    };
    updatedFeature.owner = "new owner";
    updatedFeature.tags = ["a"];
    updatedFeature.revision = {
      comment: "",
      date: new Date(),
      publishedBy: {
        email: "",
        id: "",
        name: "",
      },
      version: 1,
    };
    updatedFeature.dateUpdated = new Date();

    expect(getSDKPayloadKeysByDiff(feature, updatedFeature)).toEqual([]);

    expect(
      getSDKPayloadKeysByDiff(feature, {
        ...updatedFeature,
        defaultValue: "false",
      })
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
      getSDKPayloadKeysByDiff(feature, {
        ...updatedFeature,
        archived: true,
      })
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
      getSDKPayloadKeysByDiff(feature, {
        ...updatedFeature,
        nextScheduledUpdate: new Date(),
      })
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
      getSDKPayloadKeysByDiff(feature, {
        ...updatedFeature,
        project: "p2",
      })
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
    expect(getSDKPayloadKeysByDiff(feature, updatedFeature)).toEqual([
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
      }
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
  expect(getSDKPayloadKeysByDiff(feature, updatedFeature)).toEqual([]);
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

  it("Gets Feature Definitions", () => {
    const feature = cloneDeep(baseFeature);

    expect(
      getFeatureDefinition({
        feature,
        environment: "production",
        groupMap: groupMap,
        useDraft: false,
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
        useDraft: false,
      })
    ).toEqual(null);

    expect(
      getFeatureDefinition({
        feature,
        environment: "unknown",
        groupMap: groupMap,
        useDraft: false,
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
        useDraft: false,
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
          weights: [0.7, 0.3],
          key: "testing",
        },
      ],
    });
  });
});
