import { z } from "zod";
import { ExperimentInterface, ExperimentPhase, Variation } from "./experiments";

// Input data type based on the provided example
export interface StatsigExperimentData {
  allocation: number;
  analyticsType: string;
  benjaminiHochbergPerMetric: boolean;
  benjaminiHochbergPerVariant: boolean;
  benjaminiPrimaryMetricsOnly: boolean;
  bonferroniCorrection: boolean;
  bonferroniCorrectionPerMetric: boolean;
  cohortedMetricsMatureAfterEnd: boolean;
  controlGroupID: string;
  createdTime: number;
  creatorEmail: string;
  creatorID: string;
  creatorName: string;
  decisionReason: string | null;
  decisionTime: number | null;
  defaultConfidenceInterval: string;
  description: string;
  duration: number;
  endTime: number | null;
  groups: Array<{
    id: string;
    name: string;
    description?: string;
    parameterValues?: Record<string, any>;
    allocation?: number;
  }>;
  healthCheckStatus: string;
  healthChecks: any[];
  holdoutIDs: string[];
  hypothesis: string;
  id: string;
  idType: string;
  identityResolutionSource: string | null;
  inlineTargetingRulesJSON: string;
  lastModifiedTime: number;
  lastModifierEmail: string;
  lastModifierID: string;
  lastModifierName: string;
  launchedGroupID: string | null;
  layerID: string | null;
  name: string;
  owner: {
    ownerID: string;
    ownerType: string;
    ownerName: string;
    ownerEmail: string;
  };
  primaryMetricTags: string[];
  primaryMetrics: Array<{
    id: string;
    name: string;
    description?: string;
    type?: string;
  }>;
  reviewSettings: {
    requiredReview: boolean;
    allowedReviewers: string[];
  };
  secondaryIDType: string | null;
  secondaryMetricTags: string[];
  secondaryMetrics: Array<{
    id: string;
    name: string;
    description?: string;
    type?: string;
  }>;
  sequentialTesting: boolean;
  startTime: number;
  status: string;
  summarySections: any[];
  tags: string[];
  targetApps: any[];
  targetingGateID: string;
}

/**
 * Converts Statsig experiment data to GrowthBook experiment format
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Partial ExperimentInterface ready for creation
 */
export function convertStatsigToGrowthBook(
  statsigData: StatsigExperimentData,
  organizationId: string,
  projectId?: string
): Omit<ExperimentInterface, "id" | "dateCreated" | "dateUpdated"> {
  // Convert groups to variations
  const variations: Variation[] = statsigData.groups.map((group, index) => ({
    id: group.id,
    name: group.name,
    description: group.description || "",
    key: group.id,
    screenshots: [],
  }));

  // Create experiment phases
  const phases: ExperimentPhase[] = [
    {
      dateStarted: new Date(statsigData.startTime),
      dateEnded: statsigData.endTime ? new Date(statsigData.endTime) : undefined,
      name: "Main",
      reason: statsigData.decisionReason || "",
      coverage: statsigData.allocation / 100, // Convert percentage to decimal
      condition: statsigData.inlineTargetingRulesJSON || "{}",
      savedGroups: [],
      prerequisites: [],
      namespace: {
        enabled: false,
        name: "",
        range: [0, 1] as [number, number],
      },
      variationWeights: statsigData.groups.map((group) => 
        group.allocation ? group.allocation / 100 : 1 / statsigData.groups.length
      ),
    },
  ];

  // Map metrics
  const goalMetrics = statsigData.primaryMetrics.map((metric) => metric.id);
  const secondaryMetrics = statsigData.secondaryMetrics.map((metric) => metric.id);

  // Map status
  const statusMap: Record<string, "draft" | "running" | "stopped"> = {
    active: "running",
    draft: "draft",
    stopped: "stopped",
    completed: "stopped",
  };

  // Map analytics type to stats engine
  const statsEngineMap: Record<string, "bayesian" | "frequentist"> = {
    frequentist: "frequentist",
    bayesian: "bayesian",
  };

  const experiment: Omit<ExperimentInterface, "id" | "dateCreated" | "dateUpdated"> = {
    organization: organizationId,
    project: projectId,
    owner: statsigData.owner.ownerEmail,
    implementation: "code",
    hashAttribute: statsigData.idType === "stableID" ? "id" : "anonymousId",
    fallbackAttribute: "",
    hashVersion: 2,
    disableStickyBucketing: false,
    name: statsigData.name,
    tags: statsigData.tags || [],
    description: statsigData.description || "",
    hypothesis: statsigData.hypothesis || "",
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    variations,
    archived: false,
    status: statusMap[statsigData.status] || "draft",
    phases,
    results: undefined,
    winner: undefined,
    analysis: "",
    releasedVariationId: statsigData.launchedGroupID || "",
    excludeFromPayload: false,
    lastSnapshotAttempt: undefined,
    nextSnapshotAttempt: undefined,
    autoSnapshots: true,
    ideaSource: "",
    hasVisualChangesets: false,
    hasURLRedirects: false,
    linkedFeatures: [],
    manualLaunchChecklist: [],
    type: "standard",
    banditStage: undefined,
    banditStageDateStarted: undefined,
    banditScheduleValue: undefined,
    banditScheduleUnit: undefined,
    banditBurnInValue: undefined,
    banditBurnInUnit: undefined,
    customFields: {},
    templateId: undefined,
    shareLevel: "organization",
    analysisSummary: undefined,
    dismissedWarnings: [],
    holdoutId: statsigData.holdoutIDs.length > 0 ? statsigData.holdoutIDs[0] : undefined,
    
    // Analysis settings
    trackingKey: statsigData.id,
    datasource: "", // Left empty as requested
    exposureQueryId: "",
    goalMetrics,
    secondaryMetrics,
    guardrailMetrics: [],
    activationMetric: "",
    metricOverrides: [],
    decisionFrameworkSettings: {},
    segment: "",
    queryFilter: "",
    skipPartialData: false,
    attributionModel: "firstExposure",
    regressionAdjustmentEnabled: false,
    sequentialTestingEnabled: statsigData.sequentialTesting,
    sequentialTestingTuningParameter: 0.05,
    statsEngine: statsEngineMap[statsigData.analyticsType] || "bayesian",
  };

  return experiment;
}

/**
 * Validates the input Statsig data before conversion
 * @param data - The input data to validate
 * @returns Validation result with success/error information
 */
export function validateStatsigData(data: any): { success: boolean; error?: string } {
  try {
    // Basic required fields validation
    if (!data.id) {
      return { success: false, error: "Missing required field: id" };
    }
    if (!data.name) {
      return { success: false, error: "Missing required field: name" };
    }
    if (!data.groups || !Array.isArray(data.groups) || data.groups.length === 0) {
      return { success: false, error: "Missing or invalid groups array" };
    }
    if (!data.owner || !data.owner.ownerEmail) {
      return { success: false, error: "Missing required field: owner.ownerEmail" };
    }
    if (typeof data.startTime !== "number") {
      return { success: false, error: "Invalid startTime: must be a number" };
    }
    if (typeof data.allocation !== "number" || data.allocation < 0 || data.allocation > 100) {
      return { success: false, error: "Invalid allocation: must be a number between 0 and 100" };
    }

    // Validate groups structure
    for (const group of data.groups) {
      if (!group.id || !group.name) {
        return { success: false, error: "Each group must have id and name" };
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Validation error: ${error.message}` };
  }
}

/**
 * Helper function to convert a complete Statsig experiment with validation
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Conversion result with success/error information and converted data
 */
export function convertStatsigExperiment(
  statsigData: any,
  organizationId: string,
  projectId?: string
): { success: boolean; data?: Omit<ExperimentInterface, "id" | "dateCreated" | "dateUpdated">; error?: string } {
  // Validate input data first
  const validation = validateStatsigData(statsigData);
  if (!validation.success) {
    return { success: false, error: validation.error };
  }

  try {
    const convertedData = convertStatsigToGrowthBook(statsigData, organizationId, projectId);
    return { success: true, data: convertedData };
  } catch (error) {
    return { success: false, error: `Conversion error: ${error.message}` };
  }
}
