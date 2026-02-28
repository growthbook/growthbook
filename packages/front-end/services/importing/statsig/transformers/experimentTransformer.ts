import {
  ExperimentInterfaceStringDates,
  Variation,
} from "shared/types/experiment";
import { StatsigExperiment } from "@/services/importing/statsig/types";
import { transformStatsigConditionsToGB } from "./ruleTransformer";
import { mapStatsigAttributeToGB } from "./attributeMapper";

/**
 * Parse Statsig inline targeting rules JSON
 */
function parseInlineTargetingRules(inlineTargetingRulesJSON: string): Array<{
  groupName: string;
  percentagePass: number;
  conditionJSON: Array<{
    conditionType: number;
    operator: number;
    value: unknown[];
    extraConfig: Record<string, unknown>;
  }>;
  returnValueJSON: string;
  id: string;
  salt: string;
  idType: string;
  rollouts: unknown[];
  enabledEnvironments?: string[];
}> {
  try {
    return JSON.parse(inlineTargetingRulesJSON);
  } catch (error) {
    console.error("Failed to parse inlineTargetingRulesJSON:", error);
    return [];
  }
}

/**
 * Transform Statsig experiment to GrowthBook experiment
 */
export function transformStatsigExperimentToGB(
  experiment: StatsigExperiment,
  _availableEnvironments: string[],
  skipAttributeMapping: boolean = false,
  savedGroupIdMap?: Map<string, string>,
): Partial<ExperimentInterfaceStringDates> {
  const {
    id,
    name,
    description,
    status,
    hypothesis,
    groups,
    allocation,
    startTime,
    endTime,
    winner,
    results,
    analyticsType,
    owner,
    tags,
  } = experiment;

  // Map Statsig idType to GrowthBook hashAttribute
  const hashAttribute = mapStatsigAttributeToGB(
    experiment.idType || "user_id",
    skipAttributeMapping,
  );

  // Convert groups to variations
  const variations: Variation[] = groups.map((group, index) => ({
    id: group.id,
    name: group.name,
    description: group.description || "",
    key: index.toString(),
    screenshots: [],
    status: "active" as const,
  }));

  // Calculate variation weights from group sizes
  const totalSize = groups.reduce((sum, group) => sum + group.size, 0);
  const variationWeights = groups.map((group) => group.size / totalSize);

  // Parse targeting rules
  const targetingRules = parseInlineTargetingRules(
    experiment.inlineTargetingRulesJSON,
  );

  // Determine phase condition based on targeting rules
  let phaseCondition = "";
  let phaseSavedGroups: Array<{
    match: "all" | "any" | "none";
    ids: string[];
  }> = [];
  let phasePrerequisites: Array<{ id: string; condition: string }> = [];

  if (targetingRules.length === 1) {
    // Single rule - put condition directly on phase
    const rule = targetingRules[0];
    // Convert Statsig condition format to our format
    const conditions = rule.conditionJSON.map((cond) => ({
      type: cond.conditionType.toString(),
      operator: cond.operator.toString(),
      targetValue: cond.value,
      field: undefined,
      customID: undefined,
    }));
    const transformedCondition = transformStatsigConditionsToGB(
      conditions,
      skipAttributeMapping,
      savedGroupIdMap,
    );
    phaseCondition = transformedCondition.condition || "";
    phaseSavedGroups = transformedCondition.savedGroups;
    phasePrerequisites = transformedCondition.prerequisites || [];
  }
  const toGbStatusMap = {
    setup: "draft",
    active: "running",
    decision_made: "stopped",
    abandoned: "stopped",
  };
  // Map status
  const gbStatus = toGbStatusMap[status] || "draft";

  // Map stats engine
  const statsEngine = analyticsType === "bayesian" ? "bayesian" : "frequentist";

  // Format owner information
  const ownerString = owner ? `${owner.ownerName} (${owner.ownerEmail})` : "";

  // Create phases
  const phases = [
    {
      coverage: allocation / 100, // Convert percentage to decimal
      dateStarted: startTime
        ? new Date(startTime).toISOString().substr(0, 16)
        : "",
      dateEnded: endTime ? new Date(endTime).toISOString().substr(0, 16) : "",
      name: "Main",
      reason: results ? `Experiment ${results}` : "",
      variationWeights,
      variations,
      condition: phaseCondition,
      savedGroups: phaseSavedGroups,
      prerequisites: phasePrerequisites,
    },
  ];

  // TODO: Import actual metrics instead of placeholders
  // For now, leave metrics empty to avoid "Unknown metric" errors
  const goalMetrics: string[] = [];
  const secondaryMetricsList: string[] = [];

  return {
    name,
    description: description || "",
    hypothesis: hypothesis || "",
    status: gbStatus,
    trackingKey: id, // Use experiment ID as tracking key
    project: "", // Will be set by the importer
    datasource: "", // Will be set by the importer
    exposureQueryId: "", // Will be set by the importer
    hashAttribute, // Use mapped Statsig idType
    hashVersion: 2, // Default to v2
    disableStickyBucketing: false,
    attributionModel: "firstExposure",
    phases,
    goalMetrics,
    secondaryMetrics: secondaryMetricsList,
    guardrailMetrics: [],
    tags: tags || [],
    owner: ownerString,
    type: "standard",
    activationMetric: "",
    targetURLRegex: "",
    // Advanced stats
    statsEngine,
    // Results
    winner: winner !== undefined ? winner : undefined,
    results: results || undefined,
  };
}
