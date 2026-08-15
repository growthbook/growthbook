import { FeatureRule } from "shared/types/feature";
import { PutFeatureRuleConflict } from "shared/types/feature-rule";

// TEMPORARY DEV HARNESS — delete before merging. Opens every rule editor in a
// conflicted state contesting one chunk per rule field. Nothing is saved.
export const DEV_FAKE_CONFLICT = true;

// Every field across the FeatureRule union, minus `id` and the chunked pairs.
const SINGLE_FIELDS: Array<[string, unknown]> = [
  ["description", "their description"],
  ["condition", '{"country":"CA"}'],
  ["enabled", false],
  ["scheduleRules", [{ enabled: true, timestamp: "2026-09-01T00:00:00.000Z" }]],
  ["savedGroups", [{ match: "all", ids: ["grp_theirs"] }]],
  ["prerequisites", [{ id: "their-prereq", condition: '{"value":true}' }]],
  ["scheduleType", "schedule"],
  ["type", "rollout"],
  ["value", "their-value"],
  ["sparse", true],
  ["coverage", 0.42],
  ["hashAttribute", "deviceId"],
  ["seed", "their-seed"],
  ["hashVersion", 1],
  ["fallbackAttribute", "sessionId"],
  ["experimentType", "multi-armed-bandit"],
  ["hypothesis", "their hypothesis"],
  ["trackingKey", "their-tracking-key"],
  ["disableStickyBucketing", true],
  ["bucketVersion", 3],
  ["minBucketVersion", 1],
  ["namespace", { enabled: true, name: "their-ns", range: [0, 0.5] }],
  ["datasource", "ds_theirs"],
  ["exposureQueryId", "their-exposure-query"],
  ["goalMetrics", ["met_theirs"]],
  ["secondaryMetrics", ["met_secondary_theirs"]],
  ["guardrailMetrics", ["met_guardrail_theirs"]],
  ["activationMetric", "met_activation_theirs"],
  ["segment", "seg_theirs"],
  ["skipPartialData", true],
  [
    "values",
    [
      { value: "their-control", weight: 0.7 },
      { value: "their-variation", weight: 0.3 },
    ],
  ],
  ["regressionAdjustmentEnabled", true],
  ["sequentialTestingEnabled", true],
  ["sequentialTestingTuningParameter", 7200],
  ["statsEngine", "frequentist"],
  ["banditStage", "exploit"],
  ["banditScheduleValue", 12],
  ["banditScheduleUnit", "hours"],
  ["banditBurnInValue", 2],
  ["banditBurnInUnit", "days"],
  ["banditConversionWindowValue", 48],
  ["banditConversionWindowUnit", "hours"],
  ["templateId", "tmpl_theirs"],
  ["customFields", { theirField: "their value" }],
  ["experimentId", "exp_theirs"],
  [
    "variations",
    [
      { variationId: "var_0", value: "their-0" },
      { variationId: "var_1", value: "their-1" },
    ],
  ],
  ["contextualBanditId", "cb_theirs"],
  ["controlValue", "their-control"],
  ["variationValue", "their-variation"],
  ["safeRolloutId", "sr_theirs"],
  ["status", "stopped"],
];

const CHUNKS: Array<{ key: string; fields: string[]; values: unknown[] }> = [
  {
    key: "environments",
    fields: ["environments", "allEnvironments"],
    values: [["production"], false],
  },
  {
    key: "projects",
    fields: ["projects", "allProjects"],
    values: [["prj_theirs"], false],
  },
];

export function buildFakeConflict(
  ruleId: string,
  liveVersion: number,
  draftVersion: number | undefined,
  baseRule: FeatureRule | undefined,
): PutFeatureRuleConflict {
  const currentRule = {
    ...(baseRule ?? {}),
    id: ruleId,
  } as unknown as Record<string, unknown>;

  for (const [field, value] of SINGLE_FIELDS) currentRule[field] = value;
  for (const chunk of CHUNKS) {
    chunk.fields.forEach((f, i) => (currentRule[f] = chunk.values[i]));
  }

  return {
    ruleId,
    currentRule: currentRule as unknown as FeatureRule,
    liveVersion,
    ...(draftVersion !== undefined ? { draftVersion } : {}),
    merge: {
      contested: [
        ...SINGLE_FIELDS.map(([field]) => ({
          key: field as string,
          fields: [field as string],
        })),
        ...CHUNKS.map(({ key, fields }) => ({ key, fields })),
      ],
      theirFields: [],
      yourFields: [],
    },
  };
}
