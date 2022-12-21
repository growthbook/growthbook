import { replaceSavedGroupsInCondition } from "../src/util/features";
import { getCurrentEnabledState } from "../src/util/scheduleRules";
import { ScheduleRule } from "../types/feature";

const groupMap = new Map();

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

it("should not filter out features that have no scheduled rules calling getFeatureDefinition", () => {
  // This is testing what happens when a rule doesn't have any scheduleRules
  const scheduleRules = undefined;

  expect(getCurrentEnabledState(scheduleRules || [], new Date())).toEqual(true);
});

it("should filter out a feature that has an upcoming rule that enables it", () => {
  // This tests when a rule has a schedule rule and the current date is before the first rule's date. Aka, the startDate
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
  ];

  const date = new Date("2022-11-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
});

it("should NOT filter out a feature that has an upcoming rule that disables it", () => {
  // This tests when a rule's upcoming scheduleRule is to disable the feature.
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
  ];

  const date = new Date("2022-12-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);
});

it("should filter out a feature that has no upcoming rules", () => {
  // This tests when a rule has gone through all of it's scheduleRules.
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
  ];

  const date = new Date("2023-01-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
});

it("should NOT filter out a feature that has no upcoming rules", () => {
  // This tests when a rule has gone through all of it's scheduleRules.
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
    { scheduleRuleEnabled: false, timestamp: null },
  ];

  const date = new Date("2023-01-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);
});

it("should filter out feature if schedule rule only contains a startDate and is in the future", () => {
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
    { scheduleRuleEnabled: false, timestamp: null },
  ];

  const date = new Date("2022-11-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
});

it("should NOT filter out a feature that has a single rule to disable at a future date", () => {
  // This tests when a rule has gone through all of it's scheduleRules.
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: true, timestamp: null },
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T13:00:00.000Z" },
  ];

  const date = new Date("2022-12-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);
});

it("should filter out feature if no upcoming rule and last rule was set to disable the feature", () => {
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: true, timestamp: null },
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T13:00:00.000Z" },
  ];

  const date = new Date("2023-01-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
});

it("should handle dates that are out of chronological order", () => {
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
    { scheduleRuleEnabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
  ];

  const date = new Date("2022-12-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);
});

it("should handle dates that are out of chronological order", () => {
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
    { scheduleRuleEnabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
  ];

  const date = new Date("2023-01-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
});

it("should handle dates that are out of chronological order", () => {
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
    { scheduleRuleEnabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
  ];

  const date = new Date("2022-11-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(false);
});

it("should handle more than 2 scheduleRules correctly, even when they are out of chronological order", () => {
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
    { scheduleRuleEnabled: false, timestamp: null },
    { scheduleRuleEnabled: true, timestamp: "2023-01-05T12:00:00.000Z" },
    { scheduleRuleEnabled: true, timestamp: null },
  ];

  const date = new Date("2022-11-15T12:00:00.000Z");

  expect(getCurrentEnabledState(scheduleRules, date)).toEqual(true);
});

it("should handle more than 2 scheduleRules correctly", () => {
  const scheduleRules: ScheduleRule[] = [
    { scheduleRuleEnabled: true, timestamp: "2022-12-01T13:00:00.000Z" },
    { scheduleRuleEnabled: false, timestamp: "2022-12-30T12:00:00.000Z" },
    { scheduleRuleEnabled: true, timestamp: "2023-01-05T12:00:00.000Z" },
    { scheduleRuleEnabled: false, timestamp: "2023-01-30T12:00:00.000Z" },
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
