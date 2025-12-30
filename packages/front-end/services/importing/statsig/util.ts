import { omit } from "lodash";
import { FeatureInterface } from "shared/types/feature";
import { SavedGroupInterface } from "shared/types/groups";
import {
  StatsigMetric,
  StatsigMetricSource,
} from "@/services/importing/statsig/types";

//Transform payload for diff display
export function transformPayloadForDiffDisplay(
  payload: Record<string, unknown>,
  type:
    | "feature"
    | "experiment"
    | "segment"
    | "tag"
    | "environment"
    | "metric"
    | "metricSource",
  projectNameToIdMap?: Map<string, string>,
): Record<string, unknown> {
  let scrubbed = { ...payload };

  // Omit metadata fields based on entity type
  switch (type) {
    case "environment":
      // Omit metadata fields, keep id for environments
      scrubbed = omit(scrubbed, [
        "organization",
        "dateCreated",
        "dateUpdated",
        "toggleOnList",
        "defaultState",
      ]) as Record<string, unknown>;
      break;

    case "segment":
      // Omit metadata fields
      scrubbed = omit(scrubbed, [
        "id",
        "organization",
        "dateCreated",
        "dateUpdated",
        "useEmptyListGroup",
      ]) as Record<string, unknown>;
      // For condition-type segments, also omit "values" field
      if (
        (scrubbed as unknown as SavedGroupInterface).type === "condition" &&
        "values" in scrubbed
      ) {
        scrubbed = omit(scrubbed, ["values"]) as Record<string, unknown>;
      }
      break;

    case "feature":
      // Omit metadata fields
      scrubbed = omit(scrubbed, [
        "id",
        "organization",
        "dateCreated",
        "dateUpdated",
        "version",
        "hasDrafts",
        "jsonSchema",
        "linkedExperiments",
      ]) as Record<string, unknown>;
      // Add default values if missing
      if (!("prerequisites" in scrubbed)) {
        scrubbed.prerequisites = [];
      }
      if (!("archived" in scrubbed)) {
        scrubbed.archived = false;
      }
      break;

    case "experiment":
      // Omit metadata fields
      scrubbed = omit(scrubbed, [
        "id",
        "organization",
        "dateCreated",
        "dateUpdated",
        "analysis",
        "analysisSummary",
        "autoAssign",
        "autoSnapshots",
        "banditBurnInUnit",
        "banditBurnInValue",
        "banditScheduleUnit",
        "banditScheduleValue",
        "decisionFrameworkSettings",
        "dismissedWarnings",
        "excludeFromPayload",
        "fallbackAttribute",
        "ideaSource",
        "implementation",
        "lastSnapshotAttempt",
        "linkedFeatures",
        "manualLaunchChecklist",
        "metricOverrides",
        "nextSnapshotAttempt",
        "pastNotifications",
        "previewURL",
        "queryFilter",
        "releasedVariationId",
        "segment",
        "sequentialTestingEnabled",
        "sequentialTestingTuningParameter",
        "shareLevel",
        "skipPartialData",
        "uid",
        "userIdType",
        "screenshots",
        "dom",
      ]) as Record<string, unknown>;
      // Add default values if missing
      if (!("archived" in scrubbed)) {
        scrubbed.archived = false;
      }
      // Process phases array - omit fields and add defaults
      if ("phases" in scrubbed && Array.isArray(scrubbed.phases)) {
        scrubbed.phases = (
          scrubbed.phases as Array<Record<string, unknown>>
        ).map((phase) => {
          const cleanedPhase = omit(phase, [
            "dateStarted",
            "reason",
            "seed",
            "banditEvents",
            "groups",
            "namespace",
            "dateEnded",
          ]) as Record<string, unknown>;
          // Add default values if missing
          if (!("condition" in cleanedPhase)) {
            cleanedPhase.condition = "";
          }
          if (!("savedGroups" in cleanedPhase)) {
            cleanedPhase.savedGroups = [];
          }
          if (!("prerequisites" in cleanedPhase)) {
            cleanedPhase.prerequisites = [];
          }
          // Sort phase fields alphabetically
          const sortedKeys = Object.keys(cleanedPhase).sort();
          const sortedPhase: Record<string, unknown> = {};
          for (const key of sortedKeys) {
            sortedPhase[key] = cleanedPhase[key];
          }
          return sortedPhase;
        });
      }
      // Process variations array - omit fields and sort
      if ("variations" in scrubbed && Array.isArray(scrubbed.variations)) {
        scrubbed.variations = (
          scrubbed.variations as Array<Record<string, unknown>>
        ).map((variation) => {
          const cleanedVariation = omit(variation, [
            "screenshots",
            "dom",
          ]) as Record<string, unknown>;
          // Sort variation fields alphabetically
          const sortedKeys = Object.keys(cleanedVariation).sort();
          const sortedVariation: Record<string, unknown> = {};
          for (const key of sortedKeys) {
            sortedVariation[key] = cleanedVariation[key];
          }
          return sortedVariation;
        });
      }
      break;

    case "tag":
      // Omit metadata fields, but keep id for tags (it's part of the data)
      scrubbed = omit(scrubbed, [
        "organization",
        "dateCreated",
        "dateUpdated",
      ]) as Record<string, unknown>;
      break;

    case "metric":
      // Omit metadata/server-managed fields for metrics
      scrubbed = omit(scrubbed, [
        "id",
        "organization",
        "dateCreated",
        "dateUpdated",
        "analysis", // safety in case any analysis fields sneak in
        "datasource",
        "owner",
      ]) as Record<string, unknown>;
      // Provide default values if missing
      if (!("archived" in scrubbed)) scrubbed.archived = false;
      break;

    case "metricSource":
      // Omit metadata/server-managed fields for fact tables (metric sources)
      scrubbed = omit(scrubbed, [
        "id",
        "organization",
        "dateCreated",
        "dateUpdated",
        "columnsError",
        "archived",
        "datasource",
        "columns",
      ]) as Record<string, unknown>;
      break;
  }

  // Map project/projects fields from Statsig project name to GrowthBook project ID if mapping is provided
  // This is for the update (transformed) column - existing column already has GrowthBook IDs
  if (projectNameToIdMap) {
    // Map single project field
    if ("project" in scrubbed && typeof scrubbed.project === "string") {
      const projectName = scrubbed.project;
      const mappedId = projectNameToIdMap.get(projectName);
      if (mappedId !== undefined) {
        scrubbed.project = mappedId;
      }
    }
    // Map projects array field (for segments)
    if ("projects" in scrubbed && Array.isArray(scrubbed.projects)) {
      const mappedProjects = (scrubbed.projects as string[])
        .map((projectName) => {
          const mappedId = projectNameToIdMap.get(projectName);
          return mappedId !== undefined ? mappedId : projectName;
        })
        .filter((id) => id !== undefined && id !== null && id !== "");
      scrubbed.projects =
        mappedProjects.length > 0 ? mappedProjects : undefined;
    }
  }

  // Scrub project/projects fields if they are empty, undefined, or null
  const fieldsToScrub: string[] = [];
  if (
    "project" in scrubbed &&
    (scrubbed.project === "" ||
      scrubbed.project === undefined ||
      scrubbed.project === null)
  ) {
    fieldsToScrub.push("project");
  }
  if (
    "projects" in scrubbed &&
    (scrubbed.projects === "" ||
      scrubbed.projects === undefined ||
      scrubbed.projects === null ||
      (Array.isArray(scrubbed.projects) && scrubbed.projects.length === 0))
  ) {
    fieldsToScrub.push("projects");
  }
  if (fieldsToScrub.length > 0) {
    scrubbed = omit(scrubbed, fieldsToScrub) as Record<string, unknown>;
  }

  // Sort all top-level keys alphabetically
  const sortedKeys = Object.keys(scrubbed).sort();
  const transformed: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    transformed[key] = scrubbed[key];
  }

  // For features (feature gates and dynamic configs), sort environmentSettings keys
  if (type === "feature" && "environmentSettings" in transformed) {
    const envSettings = transformed.environmentSettings as
      | FeatureInterface["environmentSettings"]
      | undefined;
    if (envSettings && typeof envSettings === "object") {
      const sorted: FeatureInterface["environmentSettings"] = {};
      const sortedEnvKeys = Object.keys(envSettings).sort();
      for (const key of sortedEnvKeys) {
        sorted[key] = envSettings[key];
      }
      transformed.environmentSettings = sorted;
    }
  }

  // Sort nested objects (if they are present)
  const subObjectKeysToSort = [
    "numerator",
    "denominator",
    "cappingSettings",
    "windowSettings",
    "priorSettings",
    "quantileSettings",
  ];
  for (const subKey of subObjectKeysToSort) {
    if (
      subKey in transformed &&
      transformed[subKey] &&
      typeof transformed[subKey] === "object"
    ) {
      const subObj = transformed[subKey] as Record<string, unknown>;
      const sortedSubObj: Record<string, unknown> = {};
      const sortedSubKeys = Object.keys(subObj).sort();
      for (const key of sortedSubKeys) {
        sortedSubObj[key] = subObj[key];
      }
      transformed[subKey] = sortedSubObj;
    }
  }

  return transformed;
}

export const DUMMY_STATSIG_METRIC_SOURCES: StatsigMetricSource[] = [
  {
    name: "DummyMetricSource",
    description: "A dummy Statsig metric source for testing",
    sql: `SELECT 
        CAST('2025-01-01 00:00:00' AS TIMESTAMP) as event_timestamp,
        '123' as user_id,
        'abc' as anonymous_id,
        'dummy_event' as event_name,
        'a' as category,
        1 as event_value`,
    idTypeMapping: [
      {
        statsigUnitID: "UserID",
        column: "user_id",
      },
    ],
    tags: ["test"],
    owner: {
      ownerName: "Test Owner",
      ownerEmail: "test@example.com",
      ownerID: "123",
      ownerType: "user",
    },
    timestampColumn: "event_timestamp",
  },
];

export const DUMMY_STATSIG_METRICS: StatsigMetric[] = [
  {
    id: "metric_dummy",
    name: "Dummy Metric",
    description: "A dummy Statsig metric for testing",
    directionality: "increase",
    lineage: {
      events: [],
      metrics: [],
    },
    type: "user_warehouse",
    isVerified: false,
    isReadOnly: false,
    warehouseNative: {
      aggregation: "sum",
      criteria: [
        {
          type: "metadata",
          condition: "in",
          column: "event_name",
          values: ["dummy_event"],
        },
        {
          type: "metadata",
          condition: "not_in",
          column: "category",
          values: ["a", "b"],
        },
      ],
      metricSourceName: "DummyMetricSource",
      valueColumn: "event_value",
    },
  },
];
