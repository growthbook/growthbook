import { z } from "zod";
import { ExperimentInterface, ExperimentPhase, Variation } from "./experiments";

// Enhanced Statsig Experiment data structure
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
  // Additional fields for enhanced conversion
  project?: string;
  environment?: string;
  customFields?: Record<string, any>;
}

/**
 * Converts Statsig experiment data to GrowthBook experiment format
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Partial ExperimentInterface ready for creation
 */
export function convertStatsigExperimentToGrowthBook(
  statsigData: any,
  organizationId: string,
  projectId?: string
): Omit<ExperimentInterface, "id" | "dateCreated" | "dateUpdated"> {

  // Normalize the data structure to handle different field names
  const normalizedData = {
    id: statsigData.id || statsigData.experimentName || statsigData.name,
    name: statsigData.name || statsigData.experimentName || statsigData.id,
    description: statsigData.description || "",
    groups: statsigData.groups || statsigData.variants || statsigData.variations || [],
    owner: statsigData.owner || statsigData.createdBy || statsigData.creator || {},
    startTime: statsigData.startTime || statsigData.start_time || statsigData.createdTime || statsigData.created_time,
    endTime: statsigData.endTime || statsigData.end_time,
    allocation: statsigData.allocation || statsigData.traffic || statsigData.trafficAllocation || 100,
    decisionReason: statsigData.decisionReason || "",
    inlineTargetingRulesJSON: statsigData.inlineTargetingRulesJSON || "{}",
    idType: statsigData.idType || "stableID",
    status: statsigData.status || "draft",
    tags: statsigData.tags || [],
    hypothesis: statsigData.hypothesis || "",
    primaryMetrics: statsigData.primaryMetrics || [],
    secondaryMetrics: statsigData.secondaryMetrics || [],
    sequentialTesting: statsigData.sequentialTesting || false,
    analyticsType: statsigData.analyticsType || "bayesian",
    launchedGroupID: statsigData.launchedGroupID || "",
    holdoutIDs: statsigData.holdoutIDs || [],
    customFields: statsigData.customFields || {},
    project: statsigData.project
  };

  // Convert groups to variations
  const variations: Variation[] = normalizedData.groups.map((group: any, index: number) => {
    const groupId = group.id || group.variantId || group.variant_id || group.key || `variant_${index}`;
    const groupName = group.name || group.variantName || group.variant_name || groupId;
    return {
      id: groupId,
      name: groupName,
      description: group.description || "",
      key: groupId,
      screenshots: [],
    };
  });

  // Create experiment phases
  const phases: ExperimentPhase[] = [
    {
      dateStarted: new Date(normalizedData.startTime),
      dateEnded: normalizedData.endTime ? new Date(normalizedData.endTime) : undefined,
      name: "Main",
      reason: normalizedData.decisionReason,
      coverage: normalizedData.allocation / 100, // Convert percentage to decimal
      condition: normalizedData.inlineTargetingRulesJSON,
      savedGroups: [],
      prerequisites: [],
      namespace: {
        enabled: false,
        name: "",
        range: [0, 1] as [number, number],
      },
      variationWeights: normalizedData.groups.map((group: any) => 
        group.allocation ? group.allocation / 100 : 1 / normalizedData.groups.length
      ),
    },
  ];

  // Map metrics - handle different field names
  const goalMetrics = normalizedData.primaryMetrics.map((metric: any) => 
    metric.id || metric.metricId || metric.metric_id || metric.name
  );
  const secondaryMetrics = normalizedData.secondaryMetrics.map((metric: any) => 
    metric.id || metric.metricId || metric.metric_id || metric.name
  );

  // Map status
  const statusMap: Record<string, "draft" | "running" | "stopped"> = {
    active: "running",
    draft: "draft",
    stopped: "stopped",
    completed: "stopped",
    paused: "stopped",
  };

  // Map analytics type to stats engine
  const statsEngineMap: Record<string, "bayesian" | "frequentist"> = {
    frequentist: "frequentist",
    bayesian: "bayesian",
    "bayesian-sequential": "bayesian",
  };

  // Determine experiment type based on configuration
  const experimentType = normalizedData.sequentialTesting ? "multi-armed-bandit" : "standard";

  // Get owner email from various possible field names
  const ownerEmail = normalizedData.owner.ownerEmail || 
                    normalizedData.owner.email || 
                    normalizedData.owner.userID || 
                    "API_IMPORT";

  const experiment: Omit<ExperimentInterface, "id" | "dateCreated" | "dateUpdated"> = {
    organization: organizationId,
    project: projectId || normalizedData.project,
    owner: ownerEmail,
    implementation: "code",
    hashAttribute: normalizedData.idType === "stableID" ? "id" : "anonymousId",
    fallbackAttribute: "",
    hashVersion: 2,
    disableStickyBucketing: false,
    name: normalizedData.name,
    tags: normalizedData.tags,
    description: normalizedData.description,
    hypothesis: normalizedData.hypothesis,
    autoAssign: false,
    previewURL: "",
    targetURLRegex: "",
    variations,
    archived: false,
    status: statusMap[normalizedData.status] || "draft",
    phases,
    results: undefined,
    winner: undefined,
    analysis: "",
    releasedVariationId: normalizedData.launchedGroupID,
    excludeFromPayload: false,
    lastSnapshotAttempt: undefined,
    nextSnapshotAttempt: undefined,
    autoSnapshots: true,
    ideaSource: "",
    hasVisualChangesets: false,
    hasURLRedirects: false,
    linkedFeatures: [],
    manualLaunchChecklist: [],
    type: experimentType,
    banditStage: undefined,
    banditStageDateStarted: undefined,
    banditScheduleValue: undefined,
    banditScheduleUnit: undefined,
    banditBurnInValue: undefined,
    banditBurnInUnit: undefined,
    customFields: normalizedData.customFields,
    templateId: undefined,
    shareLevel: "organization",
    analysisSummary: undefined,
    dismissedWarnings: [],
    holdoutId: normalizedData.holdoutIDs.length > 0 ? normalizedData.holdoutIDs[0] : undefined,
    
    // Analysis settings
    trackingKey: normalizedData.id,
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
    sequentialTestingEnabled: normalizedData.sequentialTesting,
    sequentialTestingTuningParameter: 0.05,
    statsEngine: statsEngineMap[normalizedData.analyticsType] || "bayesian",
  };

  return experiment;
}

/**
 * Validates the input Statsig experiment data before conversion
 * @param data - The input data to validate
 * @returns Validation result with success/error information
 */
export function validateStatsigExperimentData(data: any): { success: boolean; error?: string } {
  try {
    console.log("Validating Statsig experiment data:", JSON.stringify(data, null, 2));
    
    // Basic required fields validation - be more flexible with field names
    if (!data.id && !data.experimentName && !data.name) {
      return { success: false, error: "Missing required field: id, experimentName, or name" };
    }
    
    // Handle different possible field names for name
    const name = data.name || data.experimentName || data.id;
    if (!name) {
      return { success: false, error: "Missing required field: name/experimentName" };
    }
    
    // Handle different possible field names for groups
    const groups = data.groups || data.variants || data.variations || [];
    if (!Array.isArray(groups) || groups.length === 0) {
      return { success: false, error: "Missing or invalid groups/variants array" };
    }
    
    // Handle different possible owner structures
    const owner = data.owner || data.createdBy || data.creator;
    if (!owner || (!owner.ownerEmail && !owner.email && !owner.userID)) {
      return { success: false, error: "Missing required field: owner information (ownerEmail, email, or userID)" };
    }
    
    // Handle different possible field names for startTime
    const startTime = data.startTime || data.start_time || data.createdTime || data.created_time;
    if (typeof startTime !== "number") {
      return { success: false, error: "Invalid startTime: must be a number. Found: " + typeof startTime };
    }
    
    // Handle different possible field names for allocation
    const allocation = data.allocation || data.traffic || data.trafficAllocation || 100;
    if (typeof allocation !== "number" || allocation < 0 || allocation > 100) {
      return { success: false, error: "Invalid allocation: must be a number between 0 and 100. Found: " + allocation };
    }

    // Validate groups structure - be more flexible
    for (const group of groups) {
      const groupId = group.id || group.variantId || group.variant_id || group.key;
      const groupName = group.name || group.variantName || group.variant_name || groupId;
      if (!groupId || !groupName) {
        return { success: false, error: "Each group must have id and name. Found group: " + JSON.stringify(group) };
      }
    }

    // Validate metrics if provided - be more flexible with field names
    if (data.primaryMetrics && Array.isArray(data.primaryMetrics)) {
      for (const metric of data.primaryMetrics) {
        const metricId = metric.id || metric.metricId || metric.metric_id || metric.name;
        if (!metricId) {
          return { success: false, error: "Each primary metric must have an id, metricId, or name. Found metric: " + JSON.stringify(metric) };
        }
      }
    }

    if (data.secondaryMetrics && Array.isArray(data.secondaryMetrics)) {
      for (const metric of data.secondaryMetrics) {
        const metricId = metric.id || metric.metricId || metric.metric_id || metric.name;
        if (!metricId) {
          return { success: false, error: "Each secondary metric must have an id, metricId, or name. Found metric: " + JSON.stringify(metric) };
        }
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
  const validation = validateStatsigExperimentData(statsigData);
  if (!validation.success) {
    return { success: false, error: validation.error };
  }

  try {
    const convertedData = convertStatsigExperimentToGrowthBook(statsigData, organizationId, projectId);
    return { success: true, data: convertedData };
  } catch (error) {
    return { success: false, error: `Conversion error: ${error.message}` };
  }
}
