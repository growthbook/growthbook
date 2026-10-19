import type { ExperimentInterface } from "shared/types/experiment";

// The experiment fields that reach SDK payloads, so changing one changes what
// a live experiment serves.
export const PAYLOAD_AFFECTING_EXPERIMENT_FIELDS: (keyof ExperimentInterface)[] =
  [
    "phases",
    "variations",
    "project",
    "name",
    "trackingKey",
    "archived",
    "status",
    "releasedVariationId",
    "excludeFromPayload",
    "type",
    "banditStage",
    "banditStageDateStarted",
    "banditScheduleValue",
    "banditScheduleUnit",
    "banditBurnInValue",
    "banditBurnInUnit",
    // Bucketing fields. The REST route accepts these and they end up in the SDK
    // payload, so changing bucketVersion re-buckets every user. The dashboard
    // edits them on POST /experiment/:id/targeting, which always checks this.
    "hashAttribute",
    "fallbackAttribute",
    "hashVersion",
    "disableStickyBucketing",
    "bucketVersion",
    "minBucketVersion",
  ];
