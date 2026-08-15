import { FeatureRule } from "shared/types/feature";
import { PutFeatureRuleConflict } from "shared/types/feature-rule";

/**
 * TEMPORARY DEV HARNESS — delete before merging.
 *
 * Flip to true to make every rule editor open in a conflicted state with one
 * contested chunk per field a rule can carry, so the conflict UI can be
 * iterated on without staging real concurrent edits. No request is made and
 * nothing is saved; the modal is simply seeded as if a 409 had come back.
 */
export const DEV_FAKE_CONFLICT = true;

// Every field across the FeatureRule union (see shared/validators/features.ts),
// minus `id` (never contested) and the two exclusion pairs, which are declared
// as chunks below.
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

// The mutually-exclusive pairs, which merge (and so surface) as one unit.
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

/** A 409 payload contesting every field a rule can carry. */
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
