import { FeatureInterface } from "shared/types/feature";
import { ExperimentInterfaceStringDates } from "shared/types/experiment";
import { Environment } from "shared/types/organization";
import { SavedGroupInterface } from "shared/types/saved-group";
import { TagInterface } from "shared/types/tag";
import { ProjectInterface } from "shared/types/project";
import { cloneDeep, omit } from "lodash";
import {
  FactMetricInterface,
  FactTableInterface,
  CreateFactMetricProps,
  CreateFactTableProps,
} from "shared/types/fact-table";
import { DataSourceInterfaceWithParams } from "shared/types/datasource";
import { ApiCallType } from "@/services/auth";
import { transformStatsigMetricSourceToFactTable } from "@/services/importing/statsig/transformers/metricSourceTransformer";
import { transformStatsigMetricToMetric } from "@/services/importing/statsig/transformers/metricTransformer";
import {
  StatsigFeatureGate,
  StatsigDynamicConfig,
  StatsigExperiment,
  StatsigSavedGroup,
  StatsigEnvironment,
  StatsigTag,
  StatsigFeatureGatesResponse,
  StatsigDynamicConfigsResponse,
  StatsigExperimentsResponse,
  StatsigSavedGroupsResponse,
  ImportData,
  StatsigMetric,
  StatsigMetricSource,
  ImportStatus,
  EnvironmentImport,
} from "./types";
import { transformStatsigSegmentToSavedGroup } from "./transformers/savedGroupTransformer";
import { transformStatsigFeatureGateToGB } from "./transformers/featureTransformer";
import { transformStatsigExperimentToGB } from "./transformers/experimentTransformer";
import { transformStatsigExperimentToFeature } from "./transformers/experimentRefFeatureTransformer";
import {
  DUMMY_STATSIG_METRIC_SOURCES,
  DUMMY_STATSIG_METRICS,
  transformPayloadForDiffDisplay,
} from "./util";

// Options interfaces for function parameters
export interface BuildImportedDataOptions {
  apiKey: string;
  intervalCap: number;
  features: FeatureInterface[];
  existingEnvironments: Map<string, Environment>;
  existingSavedGroups: Map<string, SavedGroupInterface>;
  existingTags: Map<string, TagInterface>;
  existingExperiments: Map<string, ExperimentInterfaceStringDates>;
  existingMetrics: Map<string, FactMetricInterface>;
  existingFactTables: Map<string, FactTableInterface>;
  callback: (data: ImportData) => void;
  skipAttributeMapping?: boolean;
  useBackendProxy?: boolean;
  project?: string;
  datasource?: DataSourceInterfaceWithParams | null;
  projects?: ProjectInterface[];
  existingAttributeSchema?: Array<{
    property: string;
    datatype:
      | "string"
      | "number"
      | "boolean"
      | "enum"
      | "secureString"
      | "string[]"
      | "number[]"
      | "secureString[]";
    archived?: boolean;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>;
}

export interface RunImportOptions {
  data: ImportData;
  existingAttributeSchema: Array<{
    property: string;
    datatype:
      | "string"
      | "number"
      | "boolean"
      | "enum"
      | "secureString"
      | "string[]"
      | "number[]"
      | "secureString[]";
    archived?: boolean;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall: ApiCallType<any>;
  callback: (data: ImportData) => void;
  featuresMap: Map<string, FeatureInterface>;
  project?: string;
  datasource?: DataSourceInterfaceWithParams | null;
  exposureQueryId?: string;
  categoryEnabled?: {
    environments: boolean;
    tags: boolean;
    segments: boolean;
    featureGates: boolean;
    dynamicConfigs: boolean;
    experiments: boolean;
    metrics: boolean;
    metricSources: boolean;
  };
  itemEnabled?: {
    [category: string]: { [key: string]: boolean };
  };
  skipAttributeMapping?: boolean;
  existingSavedGroups?: SavedGroupInterface[];
  existingExperiments?: ExperimentInterfaceStringDates[];
  existingFactTables?: FactTableInterface[];
}

/**
 * Make a direct request to Statsig Console API
 */
async function getFromStatsig<ResType>(
  endpoint: string,
  apiKey: string,
  method: string = "GET",
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<ResType> {
  // Hard-coded metrics for testing
  if (location.search.includes("dummyMetrics")) {
    if (endpoint.startsWith("metrics/metric_source/list")) {
      return {
        data: DUMMY_STATSIG_METRIC_SOURCES,
      } as ResType;
    } else if (endpoint.startsWith("metrics/list")) {
      return {
        data: DUMMY_STATSIG_METRICS,
      } as ResType;
    }
  }

  if (useBackendProxy && apiCall) {
    // Use backend proxy
    const response = await apiCall("/importing/statsig", {
      method: "POST",
      body: JSON.stringify({
        endpoint,
        method,
        apiKey,
        apiVersion: "20240601",
      }),
    });

    // Handle error responses from the proxy
    if (response.status && response.status >= 400) {
      throw new Error(
        response.message || `Statsig Console API error: ${response.status}`,
      );
    }

    return response;
  }

  const url = `https://statsigapi.net/console/v1/${endpoint}`;

  const fetchOptions: RequestInit = {
    method,
    headers: {
      "STATSIG-API-KEY": apiKey,
      "STATSIG-API-VERSION": "20240601",
      "Content-Type": "application/json",
    },
  };

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Statsig Console API error (${url}): ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  return response.json();
}

/**
 * Fetch feature gates (based on Console API endpoints)
 */
export const getStatsigFeatureGates = async (
  apiKey: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<StatsigFeatureGatesResponse> => {
  return getFromStatsig("gates", apiKey, "GET", useBackendProxy, apiCall);
};

/**
 * Fetch dynamic configs (based on Console API endpoints)
 */
export const getStatsigDynamicConfigs = async (
  apiKey: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<StatsigDynamicConfigsResponse> => {
  return getFromStatsig(
    "dynamic_configs",
    apiKey,
    "GET",
    useBackendProxy,
    apiCall,
  );
};

/**
 * Fetch experiments (based on Console API endpoints)
 */
export const getStatsigExperiments = async (
  apiKey: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<StatsigExperimentsResponse> => {
  return getFromStatsig("experiments", apiKey, "GET", useBackendProxy, apiCall);
};

/**
 * Fetch segments/saved groups (based on Console API endpoints)
 */
export const getStatsigSegments = async (
  apiKey: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<StatsigSavedGroupsResponse> => {
  return getFromStatsig("segments", apiKey, "GET", useBackendProxy, apiCall);
};

/**
 * Fetch ID list for a specific segment
 */
export const getStatsigSegmentIdList = async (
  apiKey: string,
  segmentId: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<{ data: { name: string; count: number; ids: string[] } }> => {
  return getFromStatsig(
    `segments/${segmentId}/id_list`,
    apiKey,
    "GET",
    useBackendProxy,
    apiCall,
  );
};

/**
 * Fetch tags (based on Console API endpoints)
 */
export const getStatsigTags = async (
  apiKey: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<unknown> => {
  return getFromStatsig("tags", apiKey, "GET", useBackendProxy, apiCall);
};

/**
 * Fetch metrics (based on Console API endpoints)
 */
export const getStatsigMetrics = async (
  apiKey: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<unknown> => {
  return getFromStatsig(
    "metrics/list",
    apiKey,
    "GET",
    useBackendProxy,
    apiCall,
  );
};

/**
 * Fetch metric sources
 */
export const getStatsigMetricSources = async (
  apiKey: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<unknown> => {
  return getFromStatsig(
    "metrics/metric_source/list",
    apiKey,
    "GET",
    useBackendProxy,
    apiCall,
  );
};

/**
 * Fetch environments (based on Console API endpoints)
 */
export const getStatsigEnvironments = async (
  apiKey: string,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<unknown> => {
  return getFromStatsig(
    "environments",
    apiKey,
    "GET",
    useBackendProxy,
    apiCall,
  );
};

/**
 * Fetch all pages for a given endpoint with rate limiting
 */
async function fetchAllPages(
  endpoint: string,
  apiKey: string,
  intervalCap: number = 50,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<unknown[]> {
  const PQueue = (await import("p-queue")).default;
  const queue = new PQueue({ interval: 10000, intervalCap: intervalCap });

  const allData: unknown[] = [];
  let pageNumber = 1;
  let hasMorePages = true;
  const maxPages = 50; // Safety limit to prevent infinite loops

  while (hasMorePages && pageNumber <= maxPages) {
    const response = (await queue.add(async () => {
      return getFromStatsig(
        `${endpoint}?page=${pageNumber}`,
        apiKey,
        "GET",
        useBackendProxy,
        apiCall,
      );
    })) as {
      data: unknown[] | Record<string, unknown>;
      pagination?: { nextPage: unknown };
    };

    // Handle different response structures
    let dataArray: unknown[] = [];
    if (Array.isArray(response.data)) {
      dataArray = response.data;
    } else if (response.data && typeof response.data === "object") {
      const dataObj = response.data as Record<string, unknown>;
      // Check for common nested structures
      if (dataObj.environments && Array.isArray(dataObj.environments)) {
        dataArray = dataObj.environments;
      } else if (dataObj.gates && Array.isArray(dataObj.gates)) {
        dataArray = dataObj.gates;
      } else if (dataObj.configs && Array.isArray(dataObj.configs)) {
        dataArray = dataObj.configs;
      } else if (dataObj.experiments && Array.isArray(dataObj.experiments)) {
        dataArray = dataObj.experiments;
      } else if (dataObj.segments && Array.isArray(dataObj.segments)) {
        dataArray = dataObj.segments;
      } else if (dataObj.metrics && Array.isArray(dataObj.metrics)) {
        dataArray = dataObj.metrics;
      } else if (dataObj.tags && Array.isArray(dataObj.tags)) {
        dataArray = dataObj.tags;
      } else {
        // If it's an object but we can't find a known array property, treat it as a single item
        dataArray = [response.data];
      }
    }

    if (dataArray.length > 0) {
      allData.push(...dataArray);
    } else {
      // If no data returned, assume we've reached the end
      hasMorePages = false;
      break;
    }

    // Check if there are more pages based on pagination metadata
    if (response.pagination) {
      hasMorePages = response.pagination.nextPage !== null;
    } else {
      // If no pagination metadata, assume single page (most APIs return all data on first page)
      hasMorePages = false;
    }

    pageNumber++;
  }

  if (pageNumber > maxPages) {
    console.warn(
      `Reached maximum page limit (${maxPages}) for endpoint: ${endpoint}`,
    );
  }

  return allData;
}

/**
 * Fetch all entities (convenience function)
 */
export const getAllStatsigEntities = async (
  apiKey: string,
  intervalCap: number = 50,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
) => {
  const [
    environmentsData,
    featureGatesData,
    dynamicConfigsData,
    experimentsData,
    segmentsData,
    tagsData,
    metricsData,
    metricSourcesData,
  ] = await Promise.all([
    fetchAllPages(
      "environments",
      apiKey,
      intervalCap,
      useBackendProxy,
      apiCall,
    ),
    fetchAllPages("gates", apiKey, intervalCap, useBackendProxy, apiCall),
    fetchAllPages(
      "dynamic_configs",
      apiKey,
      intervalCap,
      useBackendProxy,
      apiCall,
    ),
    fetchAllPages("experiments", apiKey, intervalCap, useBackendProxy, apiCall),
    fetchAllPages("segments", apiKey, intervalCap, useBackendProxy, apiCall),
    fetchAllPages("tags", apiKey, intervalCap, useBackendProxy, apiCall),
    fetchAllPages(
      "metrics/list",
      apiKey,
      intervalCap,
      useBackendProxy,
      apiCall,
    ),
    fetchAllPages(
      "metrics/metric_source/list",
      apiKey,
      intervalCap,
      useBackendProxy,
      apiCall,
    ),
  ]);

  // Process segments to fetch ID lists for id_list type segments
  const processedSegmentsData = await processSegmentsWithIdLists(
    segmentsData,
    apiKey,
    intervalCap,
    useBackendProxy,
    apiCall,
  );

  return {
    environments: { data: environmentsData },
    featureGates: { data: featureGatesData },
    dynamicConfigs: { data: dynamicConfigsData },
    experiments: { data: experimentsData },
    segments: { data: processedSegmentsData },
    tags: { data: tagsData },
    metrics: { data: metricsData },
    metricSources: { data: metricSourcesData },
  };
};

/**
 * Process segments to fetch ID lists for segments with type "id_list"
 */
async function processSegmentsWithIdLists(
  segmentsData: unknown[],
  apiKey: string,
  intervalCap: number,
  useBackendProxy: boolean = false,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall?: ApiCallType<any>,
): Promise<unknown[]> {
  const PQueue = (await import("p-queue")).default;
  const queue = new PQueue({ interval: 10000, intervalCap: intervalCap });

  const processedSegments = await Promise.all(
    segmentsData.map(async (segment) => {
      const seg = segment as StatsigSavedGroup;

      // If this is an id_list type segment, fetch the ID list
      if (seg.type === "id_list") {
        try {
          const idListData = await queue.add(async () => {
            return getStatsigSegmentIdList(
              apiKey,
              seg.id,
              useBackendProxy,
              apiCall,
            );
          });

          // Merge the ID list into the segment
          const ids =
            idListData && "data" in idListData
              ? idListData.data?.ids || []
              : [];
          return {
            ...seg,
            ids: ids,
          };
        } catch (error) {
          console.warn(`Failed to fetch ID list for segment ${seg.id}:`, error);
          // Return the segment without IDs if fetch fails
          return {
            ...seg,
            ids: [],
          };
        }
      }

      // Return the segment as-is for non-id_list types
      return segment;
    }),
  );

  return processedSegments;
}

/**
 * Build imported data from Statsig entities
 */
export async function buildImportedData(
  options: BuildImportedDataOptions,
): Promise<Map<string, FeatureInterface>> {
  const {
    apiKey,
    intervalCap,
    features,
    existingEnvironments,
    existingSavedGroups,
    existingTags,
    existingExperiments,
    existingMetrics,
    existingFactTables,
    callback,
    useBackendProxy = false,
    apiCall,
    project,
    datasource,
    projects = [],
    skipAttributeMapping = false,
    existingAttributeSchema = [],
  } = options;

  // Create mapping from Statsig project name to GrowthBook project ID
  // Statsig uses project names (which they call "id") while GrowthBook uses internal IDs
  const projectNameToIdMap = new Map<string, string>();
  projects.forEach((p) => {
    projectNameToIdMap.set(p.name, p.id);
  });
  const data: ImportData = {
    status: "fetching",
    environments: [],
    featureGates: [],
    dynamicConfigs: [],
    experiments: [],
    segments: [],
    tags: [],
    metrics: [],
    metricSources: [],
  };

  let featuresMap: Map<string, FeatureInterface> = new Map();

  // Debounced updater
  let timer: number | null = null;
  const update = () => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = null;
      callback(cloneDeep(data));
    }, 500);
  };

  try {
    const PQueue = (await import("p-queue")).default;
    const queue = new PQueue({ interval: 10000, intervalCap: intervalCap });

    // Fetch entities
    queue.add(async () => {
      try {
        const entities = await getAllStatsigEntities(
          apiKey,
          intervalCap,
          useBackendProxy,
          apiCall,
        );

        // Process environments
        // Note: environments.data is an array of environment objects, not nested
        entities.environments.data.forEach((environment) => {
          const env = environment as StatsigEnvironment;
          const envKey = env.name || env.id;
          const existingEnv = existingEnvironments.get(envKey);
          data.environments?.push({
            key: envKey,
            status: "pending", // Allow upserting - will use PUT if exists, POST if new
            exists: !!existingEnv,
            environment: env,
            existingEnvironment: existingEnv,
          });
        });

        // Process segments
        entities.segments.data.forEach((segment) => {
          const seg = segment as StatsigSavedGroup;
          // Match by groupName (which is set to Statsig segment id in transformer)
          const existingSavedGroup = existingSavedGroups.get(seg.id);
          data.segments?.push({
            key: seg.id,
            status: "pending", // Allow upserting - will use PUT if exists, POST if new
            exists: !!existingSavedGroup,
            segment: seg,
            existingSavedGroup: existingSavedGroup,
          });
        });

        // Process feature gates
        featuresMap = new Map(features.map((f) => [f.id, f]));
        entities.featureGates.data.forEach((gate) => {
          const fg = gate as StatsigFeatureGate;
          const existingFeature = featuresMap.get(fg.id);
          data.featureGates?.push({
            key: fg.id, // Use ID instead of name for uniqueness
            status: "pending", // Allow upserting - sync endpoint handles both
            exists: !!existingFeature,
            featureGate: fg,
            existing: existingFeature, // Store existing feature for reference
          });
        });

        // Process dynamic configs
        entities.dynamicConfigs.data.forEach((config) => {
          const dc = config as StatsigDynamicConfig;
          // Check if there's already a feature gate with the same ID
          const existingFeature = featuresMap.get(dc.id);
          const featureKey = existingFeature ? `_config_${dc.id}` : dc.id;

          data.dynamicConfigs?.push({
            key: featureKey, // Use ID instead of name for uniqueness
            status: "pending", // Allow upserting - sync endpoint handles both
            exists: !!existingFeature,
            dynamicConfig: dc,
            existing: existingFeature, // Store existing feature for reference
          });
        });

        // Process experiments
        entities.experiments.data.forEach((experiment) => {
          const exp = experiment as StatsigExperiment;
          // Match by trackingKey (which is set to Statsig experiment id in transformer)
          const existingExperiment = existingExperiments.get(exp.id);
          data.experiments?.push({
            key: exp.name,
            status: "pending", // Allow upserting - will use PUT if exists, POST if new
            exists: !!existingExperiment,
            experiment: exp,
            existingExperiment: existingExperiment,
          });
        });

        // Process tags
        entities.tags.data.forEach((tag) => {
          const t = tag as StatsigTag;
          // Match by tag id (which is set to Statsig tag name)
          const existingTag = existingTags.get(t.name);
          data.tags?.push({
            key: t.name, // Use name as key since that's what becomes the GB tag ID
            status: "pending", // Allow upserting - POST endpoint handles both
            exists: !!existingTag,
            tag: t,
            existingTag: existingTag,
          });
        });

        // Process metrics
        entities.metrics.data.forEach((metric) => {
          const m = metric as StatsigMetric;
          const existingMetric = existingMetrics.get(m.name);
          data.metrics?.push({
            key: m.id,
            status: "pending",
            exists: !!existingMetric,
            metric: m,
            existingMetric: existingMetric,
          });
        });

        // Process metric sources
        entities.metricSources.data.forEach((metricSource) => {
          const ms = metricSource as StatsigMetricSource;
          const existingFactTable = existingFactTables.get(ms.name);
          data.metricSources?.push({
            key: ms.name,
            status: "pending",
            exists: !!existingFactTable,
            metricSource: ms,
            existingMetricSource: existingFactTable,
          });
        });

        update();
      } catch (e) {
        console.error(`Error fetching entities from Statsig:`, e);
      }
    });

    await queue.onIdle();

    // Phase 2: Transform entities and detect changes
    if (apiCall && existingAttributeSchema) {
      try {
        // Build savedGroupIdMap from existing saved groups
        const savedGroupIdMap = new Map<string, string>();
        existingSavedGroups.forEach((sg) => {
          savedGroupIdMap.set(sg.groupName, sg.id);
        });

        // Get available environments
        const availableEnvironments = Array.from(existingEnvironments.keys());

        // Build combined features map for prerequisite lookups
        // This includes existing GrowthBook features and Statsig features being imported
        const combinedFeaturesMap = new Map<string, FeatureInterface>(
          features.map((f) => [f.id, f]),
        );
        // Add Statsig feature gates (boolean) and dynamic configs (json) to the map
        // We create minimal feature objects with just the id and valueType for prerequisite lookups
        data.featureGates?.forEach((gateImport) => {
          if (gateImport.featureGate) {
            const fg = gateImport.featureGate as StatsigFeatureGate;
            if (!combinedFeaturesMap.has(fg.id)) {
              combinedFeaturesMap.set(fg.id, {
                id: fg.id,
                valueType: "boolean",
              } as FeatureInterface);
            }
          }
        });
        data.dynamicConfigs?.forEach((configImport) => {
          if (configImport.dynamicConfig) {
            const dc = configImport.dynamicConfig as StatsigDynamicConfig;
            if (!combinedFeaturesMap.has(dc.id)) {
              combinedFeaturesMap.set(dc.id, {
                id: dc.id,
                valueType: "json",
              } as FeatureInterface);
            }
          }
        });

        // Transform and compare environments
        if (data.environments) {
          for (const envImport of data.environments) {
            if (envImport.environment) {
              try {
                // Transform new data
                const transformed = {
                  id: envImport.environment.name || envImport.environment.id,
                  description:
                    envImport.environment.name || envImport.environment.id,
                };

                // Pre-transform and prepare both existing and new for diff display
                if (envImport.existingEnvironment) {
                  // Prepare existing data (scrubbed and sorted)
                  const existingForDiff = transformPayloadForDiffDisplay(
                    envImport.existingEnvironment as Record<string, unknown>,
                    "environment",
                  );
                  envImport.existingData = JSON.stringify(
                    existingForDiff,
                    null,
                    2,
                  );

                  // Prepare transformed data (scrubbed and sorted)
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformed as Record<string, unknown>,
                    "environment",
                    projectNameToIdMap,
                  );
                  envImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );

                  // Compare for hasChanges
                  envImport.hasChanges =
                    JSON.stringify(existingForDiff) !==
                    JSON.stringify(transformedForDiff);
                } else {
                  // New item - only prepare transformed data
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformed,
                    "environment",
                    projectNameToIdMap,
                  );
                  envImport.hasChanges = false;
                  envImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );
                }
              } catch (e) {
                console.warn(
                  `Failed to transform environment ${envImport.key}:`,
                  e,
                );
              }
            }
          }
        }

        // Transform and compare segments
        if (data.segments) {
          for (const segmentImport of data.segments) {
            if (segmentImport.segment) {
              try {
                const transformed = await transformStatsigSegmentToSavedGroup(
                  segmentImport.segment,
                  existingAttributeSchema,
                  apiCall,
                  project,
                  skipAttributeMapping,
                  savedGroupIdMap,
                );
                segmentImport.transformedSavedGroup = transformed;

                // Pre-transform and prepare both existing and new for diff display
                if (segmentImport.existingSavedGroup) {
                  // Prepare existing data (scrubbed and sorted)
                  // Note: existing data should already have GrowthBook project IDs,
                  // but we pass projectNameToIdMap for consistency in case it has names
                  const existingForDiff = transformPayloadForDiffDisplay(
                    segmentImport.existingSavedGroup as unknown as Record<
                      string,
                      unknown
                    >,
                    "segment",
                    projectNameToIdMap,
                  );
                  segmentImport.existingData = JSON.stringify(
                    existingForDiff,
                    null,
                    2,
                  );

                  // Prepare transformed data (scrubbed and sorted)
                  // Transformed data has Statsig project names that need mapping to GrowthBook IDs
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformed as Record<string, unknown>,
                    "segment",
                    projectNameToIdMap,
                  );
                  segmentImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );

                  // Compare for hasChanges
                  segmentImport.hasChanges =
                    JSON.stringify(existingForDiff) !==
                    JSON.stringify(transformedForDiff);
                } else {
                  // New item - only prepare transformed data
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformed as Record<string, unknown>,
                    "segment",
                    projectNameToIdMap,
                  );
                  segmentImport.hasChanges = false;
                  segmentImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );
                }
              } catch (e) {
                console.warn(
                  `Failed to transform segment ${segmentImport.key}:`,
                  e,
                );
              }
            }
          }
        }

        // Transform and compare feature gates
        if (data.featureGates) {
          for (const gateImport of data.featureGates) {
            if (gateImport.featureGate) {
              try {
                const transformed = await transformStatsigFeatureGateToGB(
                  gateImport.featureGate,
                  availableEnvironments,
                  existingAttributeSchema,
                  apiCall,
                  "featureGate",
                  project,
                  skipAttributeMapping,
                  savedGroupIdMap,
                  combinedFeaturesMap,
                );
                gateImport.feature = transformed;

                // Pre-transform and prepare both existing and new for diff display
                if (gateImport.existing) {
                  // Prepare existing data (scrubbed and sorted)
                  const existingForDiff = transformPayloadForDiffDisplay(
                    gateImport.existing as Record<string, unknown>,
                    "feature",
                  );

                  // Prepare transformed data (scrubbed and sorted)
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformed as Record<string, unknown>,
                    "feature",
                    projectNameToIdMap,
                  );
                  // Filter existing environmentSettings to only include environments that exist in transformed
                  if (
                    "environmentSettings" in existingForDiff &&
                    "environmentSettings" in transformedForDiff &&
                    typeof existingForDiff.environmentSettings === "object" &&
                    typeof transformedForDiff.environmentSettings ===
                      "object" &&
                    existingForDiff.environmentSettings !== null &&
                    transformedForDiff.environmentSettings !== null
                  ) {
                    const existingEnvSettings =
                      existingForDiff.environmentSettings as Record<
                        string,
                        unknown
                      >;
                    const transformedEnvSettings =
                      transformedForDiff.environmentSettings as Record<
                        string,
                        unknown
                      >;
                    const transformedEnvKeys = new Set(
                      Object.keys(transformedEnvSettings),
                    );
                    const filteredExistingEnvSettings: Record<string, unknown> =
                      {};
                    for (const key of Object.keys(existingEnvSettings)) {
                      if (transformedEnvKeys.has(key)) {
                        filteredExistingEnvSettings[key] =
                          existingEnvSettings[key];
                      }
                    }
                    existingForDiff.environmentSettings =
                      filteredExistingEnvSettings;
                  }
                  gateImport.existingData = JSON.stringify(
                    existingForDiff,
                    null,
                    2,
                  );
                  gateImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );

                  // Compare for hasChanges
                  gateImport.hasChanges =
                    JSON.stringify(existingForDiff) !==
                    JSON.stringify(transformedForDiff);
                } else {
                  // New item - only prepare transformed data
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformed as Record<string, unknown>,
                    "feature",
                    projectNameToIdMap,
                  );
                  gateImport.hasChanges = false;
                  gateImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );
                }
              } catch (e) {
                console.warn(
                  `Failed to transform feature gate ${gateImport.key}:`,
                  e,
                );
              }
            }
          }
        }

        // Transform and compare dynamic configs
        if (data.dynamicConfigs) {
          for (const configImport of data.dynamicConfigs) {
            if (configImport.dynamicConfig) {
              try {
                const transformed = await transformStatsigFeatureGateToGB(
                  configImport.dynamicConfig,
                  availableEnvironments,
                  existingAttributeSchema,
                  apiCall,
                  "dynamicConfig",
                  project,
                  skipAttributeMapping,
                  savedGroupIdMap,
                  combinedFeaturesMap,
                );
                configImport.feature = transformed;

                // Pre-transform and prepare both existing and new for diff display
                if (configImport.existing) {
                  // Prepare existing data (scrubbed and sorted)
                  const existingForDiff = transformPayloadForDiffDisplay(
                    configImport.existing as Record<string, unknown>,
                    "feature",
                  );

                  // Prepare transformed data (scrubbed and sorted)
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformed as Record<string, unknown>,
                    "feature",
                    projectNameToIdMap,
                  );
                  // Filter existing environmentSettings to only include environments that exist in transformed
                  if (
                    "environmentSettings" in existingForDiff &&
                    "environmentSettings" in transformedForDiff &&
                    typeof existingForDiff.environmentSettings === "object" &&
                    typeof transformedForDiff.environmentSettings ===
                      "object" &&
                    existingForDiff.environmentSettings !== null &&
                    transformedForDiff.environmentSettings !== null
                  ) {
                    const existingEnvSettings =
                      existingForDiff.environmentSettings as Record<
                        string,
                        unknown
                      >;
                    const transformedEnvSettings =
                      transformedForDiff.environmentSettings as Record<
                        string,
                        unknown
                      >;
                    const transformedEnvKeys = new Set(
                      Object.keys(transformedEnvSettings),
                    );
                    const filteredExistingEnvSettings: Record<string, unknown> =
                      {};
                    for (const key of Object.keys(existingEnvSettings)) {
                      if (transformedEnvKeys.has(key)) {
                        filteredExistingEnvSettings[key] =
                          existingEnvSettings[key];
                      }
                    }
                    existingForDiff.environmentSettings =
                      filteredExistingEnvSettings;
                  }
                  configImport.existingData = JSON.stringify(
                    existingForDiff,
                    null,
                    2,
                  );
                  configImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );

                  // Compare for hasChanges
                  configImport.hasChanges =
                    JSON.stringify(existingForDiff) !==
                    JSON.stringify(transformedForDiff);
                } else {
                  // New item - only prepare transformed data
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformed as Record<string, unknown>,
                    "feature",
                    projectNameToIdMap,
                  );
                  configImport.hasChanges = false;
                  configImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );
                }
              } catch (e) {
                console.warn(
                  `Failed to transform dynamic config ${configImport.key}:`,
                  e,
                );
              }
            }
          }
        }

        // Transform and compare experiments
        if (data.experiments) {
          for (const expImport of data.experiments) {
            if (expImport.experiment) {
              try {
                const transformedExp = transformStatsigExperimentToGB(
                  expImport.experiment,
                  availableEnvironments,
                  skipAttributeMapping,
                  savedGroupIdMap,
                );
                // Set project from the top-level input form's project field
                transformedExp.project = project || "";
                expImport.transformedExperiment = transformedExp;

                // Pre-transform and prepare both existing and new for diff display
                if (expImport.existingExperiment) {
                  // Prepare existing data (scrubbed and sorted)
                  const existingForDiff = transformPayloadForDiffDisplay(
                    expImport.existingExperiment as Record<string, unknown>,
                    "experiment",
                  );
                  expImport.existingData = JSON.stringify(
                    existingForDiff,
                    null,
                    2,
                  );

                  // Prepare transformed data (scrubbed and sorted)
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformedExp as Record<string, unknown>,
                    "experiment",
                    projectNameToIdMap,
                  );
                  expImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );

                  // Compare for hasChanges
                  // Use JSON.stringify for comparison to handle floating point precision and object reference differences
                  const existingJsonStr = JSON.stringify(existingForDiff);
                  const transformedJsonStr = JSON.stringify(transformedForDiff);
                  expImport.hasChanges = existingJsonStr !== transformedJsonStr;
                } else {
                  // New item - only prepare transformed data
                  const transformedForDiff = transformPayloadForDiffDisplay(
                    transformedExp as Record<string, unknown>,
                    "experiment",
                    projectNameToIdMap,
                  );
                  expImport.hasChanges = false;
                  expImport.transformedData = JSON.stringify(
                    transformedForDiff,
                    null,
                    2,
                  );
                }
              } catch (e) {
                console.warn(
                  `Failed to transform experiment ${expImport.key}:`,
                  e,
                );
              }
            }
          }
        }

        // Transform and compare tags
        if (data.tags) {
          for (const tagImport of data.tags) {
            if (tagImport.tag) {
              const transformed: TagInterface = {
                id: tagImport.tag.name,
                description: tagImport.tag.description || "",
                color: tagImport.tag.isCore ? "purple" : "blue",
              };
              tagImport.transformedTag = transformed;

              // Pre-transform and prepare both existing and new for diff display
              if (tagImport.existingTag) {
                // Prepare existing data (scrubbed and sorted)
                const existingForDiff = transformPayloadForDiffDisplay(
                  tagImport.existingTag as unknown as Record<string, unknown>,
                  "tag",
                );
                tagImport.existingData = JSON.stringify(
                  existingForDiff,
                  null,
                  2,
                );

                // Prepare transformed data (scrubbed and sorted)
                const transformedForDiff = transformPayloadForDiffDisplay(
                  { ...transformed } as Record<string, unknown>,
                  "tag",
                  projectNameToIdMap,
                );
                tagImport.transformedData = JSON.stringify(
                  transformedForDiff,
                  null,
                  2,
                );

                // Compare for hasChanges
                tagImport.hasChanges =
                  JSON.stringify(existingForDiff) !==
                  JSON.stringify(transformedForDiff);
              } else {
                // New item - only prepare transformed data
                const transformedForDiff = transformPayloadForDiffDisplay(
                  { ...transformed } as Record<string, unknown>,
                  "tag",
                  projectNameToIdMap,
                );
                tagImport.hasChanges = false;
                tagImport.transformedData = JSON.stringify(
                  transformedForDiff,
                  null,
                  2,
                );
              }
            }
          }
        }

        if (data.metrics) {
          // Build a mapping from existing fact table names to their ids
          const metricSourceIdMap = new Map<string, string>();
          existingFactTables.forEach((ft) => {
            metricSourceIdMap.set(ft.name, ft.id);
          });

          // For new metric sources being imported, add placeholder IDs to the map
          // This allows metrics to be transformed/previewed before fact tables are actually created
          // The placeholder IDs are replaced with real IDs during the actual import phase
          data.metricSources?.forEach((ms) => {
            if (
              ms.metricSource &&
              !metricSourceIdMap.has(ms.metricSource.name)
            ) {
              // Use a temporary ID that matches the name - this will be replaced during actual import
              metricSourceIdMap.set(
                ms.metricSource.name,
                `temp_${ms.metricSource.name.replace(/\s/g, "_")}`,
              );
            }
          });

          for (const metricImport of data.metrics) {
            if (!metricImport.metric) continue;
            try {
              const transformed = await transformStatsigMetricToMetric(
                metricImport.metric,
                metricSourceIdMap,
                project || "",
                datasource?.id || "",
              );
              metricImport.transformedMetric =
                transformed as CreateFactMetricProps;

              if (metricImport.existingMetric) {
                const existingForDiff = transformPayloadForDiffDisplay(
                  metricImport.existingMetric as unknown as Record<
                    string,
                    unknown
                  >,
                  "metric",
                );
                metricImport.existingData = JSON.stringify(
                  existingForDiff,
                  null,
                  2,
                );
                const transformedForDiff = transformPayloadForDiffDisplay(
                  { ...transformed } as Record<string, unknown>,
                  "metric",
                  projectNameToIdMap,
                );
                metricImport.transformedData = JSON.stringify(
                  transformedForDiff,
                  null,
                  2,
                );
                metricImport.hasChanges =
                  JSON.stringify(existingForDiff) !==
                  JSON.stringify(transformedForDiff);
              } else {
                const transformedForDiff = transformPayloadForDiffDisplay(
                  { ...transformed } as Record<string, unknown>,
                  "metric",
                  projectNameToIdMap,
                );
                metricImport.transformedData = JSON.stringify(
                  transformedForDiff,
                  null,
                  2,
                );
                metricImport.hasChanges = false;
              }
            } catch (e) {
              console.warn(
                `Failed to transform metric ${metricImport.key}:`,
                e,
              );
            }
          }
        }

        if (data.metricSources) {
          for (const msImport of data.metricSources) {
            if (!msImport.metricSource) continue;
            try {
              const transformed =
                (await transformStatsigMetricSourceToFactTable(
                  msImport.metricSource,
                  project || "",
                  datasource,
                )) as FactTableInterface;

              msImport.transformedMetricSource =
                transformed as CreateFactTableProps;
              if (msImport.existingMetricSource) {
                const existingForDiff = transformPayloadForDiffDisplay(
                  msImport.existingMetricSource as unknown as Record<
                    string,
                    unknown
                  >,
                  "metricSource",
                );
                msImport.existingData = JSON.stringify(
                  existingForDiff,
                  null,
                  2,
                );
                const transformedForDiff = transformPayloadForDiffDisplay(
                  { ...transformed } as Record<string, unknown>,
                  "metricSource",
                  projectNameToIdMap,
                );
                msImport.transformedData = JSON.stringify(
                  transformedForDiff,
                  null,
                  2,
                );
                msImport.hasChanges =
                  JSON.stringify(existingForDiff) !==
                  JSON.stringify(transformedForDiff);
              } else {
                const transformedForDiff = transformPayloadForDiffDisplay(
                  { ...transformed } as Record<string, unknown>,
                  "metricSource",
                  projectNameToIdMap,
                );
                msImport.transformedData = JSON.stringify(
                  transformedForDiff,
                  null,
                  2,
                );
                msImport.hasChanges = false;
              }
            } catch (e) {
              console.warn(
                `Failed to transform metric source ${msImport.key}:`,
                e,
              );
            }
          }
        }

        update();
      } catch (e) {
        console.warn("Error transforming entities for preview:", e);
      }
    }

    timer && clearTimeout(timer);
    data.status = "ready";
    callback(data);
  } catch (e) {
    console.error("Error in buildImportedData:", e);
    data.status = "error";
    data.error = e.message;
    callback(data);
    throw e;
  }

  return featuresMap;
}

/**
 * Run the import process
 */
export async function runImport(options: RunImportOptions) {
  const {
    data: originalData,
    existingAttributeSchema,
    apiCall,
    callback,
    featuresMap,
    project,
    datasource,
    exposureQueryId,
    categoryEnabled,
    itemEnabled,
    skipAttributeMapping,
    existingSavedGroups,
    existingExperiments,
    existingFactTables,
  } = options;
  // We will mutate this shared object and sync it back to the component periodically
  const data = cloneDeep(originalData);

  // Debounced updater
  let timer: number | null = null;
  const update = () => {
    if (timer) return;
    timer = window.setTimeout(() => {
      timer = null;
      callback(cloneDeep(data));
    }, 500);
  };

  data.status = "importing";
  update();

  // Map to track StatSig segment names to GrowthBook saved group IDs
  const savedGroupIdMap = new Map<string, string>();

  // Build mapping from existing saved group names to IDs and objects
  const existingSavedGroupsMap = new Map<string, SavedGroupInterface>();
  if (existingSavedGroups) {
    existingSavedGroups.forEach((sg: SavedGroupInterface) => {
      savedGroupIdMap.set(sg.groupName, sg.id);
      existingSavedGroupsMap.set(sg.groupName, sg);
    });
  }

  // Build mapping from existing experiments by trackingKey
  const existingExperimentsMap = new Map<
    string,
    ExperimentInterfaceStringDates
  >();
  if (existingExperiments) {
    existingExperiments.forEach((exp: ExperimentInterfaceStringDates) => {
      if (exp.trackingKey) {
        existingExperimentsMap.set(exp.trackingKey, exp);
      }
    });
  }

  const metricSourceIdMap = new Map<string, string>();

  // Build mapping from existing fact table names to IDs
  if (existingFactTables) {
    existingFactTables.forEach((ft: FactTableInterface) => {
      metricSourceIdMap.set(ft.name, ft.id);
    });
  }

  // Helper function to check if an item should be imported
  const shouldImportItem = (
    category: string,
    index: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    item: any,
  ): boolean => {
    // Check category-level checkbox first
    if (
      categoryEnabled &&
      !categoryEnabled[category as keyof typeof categoryEnabled]
    ) {
      return false;
    }

    // Check item-level checkbox
    if (itemEnabled && itemEnabled[category]) {
      const key = getItemKey(category, index, item);
      return itemEnabled[category][key] === true;
    }

    return !itemEnabled;
  };

  // Helper function to check if an item can be processed (pending or re-runnable)
  const canProcessItem = (status: ImportStatus): boolean => {
    // Allow processing if pending, or if it's a completed/failed status that can be re-run
    return (
      status === "pending" || status === "completed" || status === "failed"
    );
  };

  // Helper function to get item key (same logic as in component)
  const getItemKey = (
    category: string,
    index: number,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    item: any,
  ): string => {
    switch (category) {
      case "environments":
        return `env-${item.environment?.name || index}`;
      case "tags":
        return `tag-${item.tag?.name || item.tag?.id || index}`;
      case "segments":
        return `segment-${item.segment?.name || item.segment?.id || index}`;
      case "featureGates":
        return `gate-${item.featureGate?.id || index}`;
      case "dynamicConfigs":
        return `config-${item.dynamicConfig?.id || index}`;
      case "experiments":
        return `exp-${item.experiment?.name || item.experiment?.id || index}`;
      case "metrics":
        return `metric-${item.metric?.name || index}`;
      case "metricSources":
        return `metricSource-${item.metricSource?.name || index}`;
      default:
        return `${category}-${index}`;
    }
  };

  const PQueue = (await import("p-queue")).default;
  const queue = new PQueue({ concurrency: 6 });

  // Helper to (re)populate the queue with Saved Group (Segment) import jobs.
  // When retryUnknownOnly is true, only segments whose transformed condition
  // still contains the "__unknown_group__" placeholder will be processed.
  // Each segment will only be retried for unknown groups at most once.
  const repopulateSegmentQueue = (retryUnknownOnly: boolean) => {
    data.segments?.forEach((segment, index) => {
      if (
        !canProcessItem(segment.status) ||
        !shouldImportItem("segments", index, segment)
      ) {
        return;
      }

      if (retryUnknownOnly) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const segAny = segment as any;
        if (
          segAny._unknownGroupsRetried ||
          !segment.transformedSavedGroup?.condition?.includes(
            "__unknown_group__",
          )
        ) {
          // Skip segments that either don't have unresolved nested group
          // references or have already been retried once.
          return;
        }
        segAny._unknownGroupsRetried = true;
      }

      queue.add(async () => {
        // Reset status to pending when (re-)running
        segment.status = "pending";
        try {
          const seg = segment.segment as StatsigSavedGroup;

          // Transform Statsig segment to GrowthBook saved group using the
          // latest savedGroupIdMap (which will be more complete on retries).
          const savedGroupData = await transformStatsigSegmentToSavedGroup(
            seg,
            existingAttributeSchema,
            apiCall,
            project,
            skipAttributeMapping,
            savedGroupIdMap,
          );

          // Keep the transformed version on the segment for UI/debugging
          segment.transformedSavedGroup = savedGroupData;

          // Check if saved group already exists (by groupName)
          const existingSavedGroup = existingSavedGroupsMap.get(
            savedGroupData.groupName,
          );
          const isUpdate = !!existingSavedGroup;

          let res: { savedGroup: SavedGroupInterface };
          if (isUpdate) {
            // Use PUT to update existing saved group, always skipping cycle checks
            const putRes = await apiCall(
              `/saved-groups/${existingSavedGroup.id}?skipCycleCheck=1`,
              {
                method: "PUT",
                body: JSON.stringify(savedGroupData),
              },
            );
            // PUT returns { status: 200 } or { savedGroup: ... }, handle both
            if ((putRes as { savedGroup?: SavedGroupInterface }).savedGroup) {
              res = putRes as { savedGroup: SavedGroupInterface };
              // Keep the in-memory map in sync with the latest saved group
              existingSavedGroupsMap.set(
                savedGroupData.groupName,
                res.savedGroup,
              );
            } else {
              // If PUT doesn't return the saved group, fall back to the existing one
              res = { savedGroup: existingSavedGroup };
            }
          } else {
            // Use POST to create new saved group, always skipping cycle checks
            res = await apiCall("/saved-groups?skipCycleCheck=1", {
              method: "POST",
              body: JSON.stringify(savedGroupData),
            });
            // Newly created saved group should be available for subsequent passes
            existingSavedGroupsMap.set(
              savedGroupData.groupName,
              res.savedGroup,
            );
          }

          segment.status = "completed";
          segment.exists = isUpdate;
          segment.existingSavedGroup = existingSavedGroup;
          // Clear any previous error message from earlier attempts so the UI
          // reflects the latest successful import state.
          segment.error = undefined;

          // Map Statsig segment name to GrowthBook saved group ID
          savedGroupIdMap.set(seg.id, res.savedGroup.id);
        } catch (e) {
          const isUpdate = !!segment.existingSavedGroup;
          segment.status = "failed";
          segment.exists = isUpdate;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          segment.error = (e as any)?.message || String(e);
        }
        update();
      });
    });
  };

  // Import Environments in a single API call
  queue.add(async () => {
    const envsToAdd: Environment[] = [];
    const envsToProcess: EnvironmentImport[] = [];
    data.environments?.forEach((e, index) => {
      if (
        canProcessItem(e.status) &&
        e.environment &&
        shouldImportItem("environments", index, e)
      ) {
        envsToAdd.push({
          id: e.environment.name,
          description: e.environment.name,
        });
        envsToProcess.push(e);
        // Reset status to pending when re-running
        e.status = "pending";
      }
    });

    if (envsToAdd.length > 0) {
      try {
        await apiCall("/environment", {
          method: "PUT",
          body: JSON.stringify({
            environments: envsToAdd,
          }),
        });
        envsToProcess.forEach((env) => {
          env.status = "completed";
          env.exists = false; // Environments are always created
        });
      } catch (e) {
        envsToProcess.forEach((env) => {
          env.status = "failed";
          env.exists = false;
          env.error = e.message;
        });
      }
    }
    update();
  });
  await queue.onIdle();

  // Import Saved Groups (Segments) in two phases:
  // 1) First pass processes all selected segments.
  // 2) Second pass only retries those whose transformed condition still
  //    contains the "__unknown_group__" placeholder (nested segments that
  //    couldn't be resolved on the first pass).
  repopulateSegmentQueue(false);
  await queue.onIdle();
  repopulateSegmentQueue(true);
  await queue.onIdle();

  // Build combined features map for prerequisite lookups
  // This includes existing GrowthBook features and Statsig features being imported
  const combinedFeaturesMap = new Map<string, FeatureInterface>(
    Array.from(featuresMap.entries()),
  );
  // Add Statsig feature gates (boolean) and dynamic configs (json) to the map
  data.featureGates?.forEach((gateImport) => {
    if (gateImport.featureGate) {
      const fg = gateImport.featureGate as StatsigFeatureGate;
      if (!combinedFeaturesMap.has(fg.id)) {
        combinedFeaturesMap.set(fg.id, {
          id: fg.id,
          valueType: "boolean",
        } as FeatureInterface);
      }
    }
  });
  data.dynamicConfigs?.forEach((configImport) => {
    if (configImport.dynamicConfig) {
      const dc = configImport.dynamicConfig as StatsigDynamicConfig;
      if (!combinedFeaturesMap.has(dc.id)) {
        combinedFeaturesMap.set(dc.id, {
          id: dc.id,
          valueType: "json",
        } as FeatureInterface);
      }
    }
  });

  // Import Feature Gates
  data.featureGates?.forEach((featureGate, index) => {
    if (
      canProcessItem(featureGate.status) &&
      shouldImportItem("featureGates", index, featureGate)
    ) {
      queue.add(async () => {
        // Reset status to pending when re-running
        featureGate.status = "pending";
        try {
          const fg = featureGate.featureGate as StatsigFeatureGate;
          if (!fg) {
            throw new Error("No feature gate data available");
          }

          // Transform Statsig feature gate to GrowthBook feature
          // Get available environments from the processed data
          const availableEnvironments =
            data.environments
              ?.map((e) => e.environment?.name || e.key)
              .filter(Boolean) || [];

          const transformedFeature = await transformStatsigFeatureGateToGB(
            fg,
            availableEnvironments,
            existingAttributeSchema,
            apiCall,
            "featureGate",
            project,
            skipAttributeMapping,
            savedGroupIdMap,
            combinedFeaturesMap,
          );

          const featureIsUpdate = !!featureGate.existing;
          const res: { feature: FeatureInterface } = await apiCall(
            `/feature/${featureGate.key}/sync`,
            {
              method: "POST",
              body: JSON.stringify(transformedFeature),
            },
          );

          featureGate.status = "completed";
          featureGate.exists = featureIsUpdate;
          featureGate.existing = res.feature;
        } catch (e) {
          const featureIsUpdate = !!featureGate.existing;
          featureGate.status = "failed";
          featureGate.exists = featureIsUpdate;
          featureGate.error = e.message;
        }
        update();
      });
    }
  });
  await queue.onIdle();

  // Import Dynamic Configs
  data.dynamicConfigs?.forEach((dynamicConfig, index) => {
    if (
      canProcessItem(dynamicConfig.status) &&
      shouldImportItem("dynamicConfigs", index, dynamicConfig)
    ) {
      queue.add(async () => {
        // Reset status to pending when re-running
        dynamicConfig.status = "pending";
        try {
          const dc = dynamicConfig.dynamicConfig as StatsigDynamicConfig;
          if (!dc) {
            throw new Error("No dynamic config data available");
          }

          // Transform Statsig dynamic config to GrowthBook feature
          // Get available environments from the processed data
          const availableEnvironments =
            data.environments
              ?.map((e) => e.environment?.name || e.key)
              .filter(Boolean) || [];

          const transformedFeature = await transformStatsigFeatureGateToGB(
            dc,
            availableEnvironments,
            existingAttributeSchema,
            apiCall,
            "dynamicConfig",
            project,
            skipAttributeMapping,
            savedGroupIdMap,
            combinedFeaturesMap,
          );

          const isUpdate = !!dynamicConfig.existing;
          const res: { feature: FeatureInterface } = await apiCall(
            `/feature/${dynamicConfig.key}/sync`,
            {
              method: "POST",
              body: JSON.stringify(transformedFeature),
            },
          );

          dynamicConfig.status = "completed";
          dynamicConfig.exists = isUpdate;
          dynamicConfig.existing = res.feature;
        } catch (e) {
          const isUpdate = !!dynamicConfig.existing;
          dynamicConfig.status = "failed";
          dynamicConfig.exists = isUpdate;
          dynamicConfig.error = e.message;
        }
        update();
      });
    }
  });
  await queue.onIdle();

  // Import Experiments
  data.experiments?.forEach((experiment, index) => {
    if (
      canProcessItem(experiment.status) &&
      shouldImportItem("experiments", index, experiment)
    ) {
      queue.add(async () => {
        // Reset status to pending when re-running
        experiment.status = "pending";
        const featureId: string | null = null;
        try {
          const exp = experiment.experiment as StatsigExperiment;
          if (!exp) {
            throw new Error("No experiment data available");
          }

          // Get available environments from the processed data
          const availableEnvironments =
            data.environments
              ?.map((e) => e.environment?.name || e.key)
              .filter(Boolean) || [];

          // Transform Statsig experiment to GrowthBook experiment
          const transformedExperiment = await transformStatsigExperimentToGB(
            exp,
            availableEnvironments,
            skipAttributeMapping,
            savedGroupIdMap,
          );

          // Set project and datasource (will be provided by the importer)
          transformedExperiment.project = project || "";
          transformedExperiment.datasource = datasource?.id || "";
          transformedExperiment.exposureQueryId = exposureQueryId || "";

          // Check if experiment already exists (by trackingKey)
          const existingExperiment = transformedExperiment.trackingKey
            ? existingExperimentsMap.get(transformedExperiment.trackingKey)
            : undefined;
          const isUpdate = !!existingExperiment;

          // Create or update the experiment
          let experimentRes: { experiment: ExperimentInterfaceStringDates };
          if (isUpdate && existingExperiment) {
            // Use POST to update existing experiment (POST /experiment/:id)
            experimentRes = await apiCall(
              `/experiment/${existingExperiment.id}`,
              {
                method: "POST",
                body: JSON.stringify(transformedExperiment),
              },
            );
          } else {
            // Use POST to create new experiment
            experimentRes = await apiCall(`/experiments`, {
              method: "POST",
              body: JSON.stringify(transformedExperiment),
            });
          }

          // Check if experiment creation was successful
          if (
            !experimentRes ||
            (typeof experimentRes === "object" &&
              "status" in experimentRes &&
              typeof experimentRes.status === "number" &&
              experimentRes.status >= 400)
          ) {
            const errorMessage =
              typeof experimentRes === "object" &&
              "message" in experimentRes &&
              typeof experimentRes.message === "string"
                ? experimentRes.message
                : "Unknown error";
            throw new Error(`Experiment creation failed: ${errorMessage}`);
          }

          // Create the companion feature
          const transformedFeature = await transformStatsigExperimentToFeature(
            exp,
            availableEnvironments,
            {
              id: experimentRes.experiment.id,
              variations: experimentRes.experiment.variations.map((v) => ({
                id: v.id,
                key: v.key,
              })),
            },
            project,
            skipAttributeMapping,
            savedGroupIdMap,
          );

          // For updates, check if there's an existing companion feature linked to the experiment
          let featureId = transformedFeature.id;
          let existingCompanionFeature: FeatureInterface | undefined;

          if (
            existingExperiment?.linkedFeatures &&
            existingExperiment.linkedFeatures.length > 0
          ) {
            // Find the companion feature by checking if it references this experiment
            // The companion feature should have experiment-ref rules pointing to this experiment
            const linkedFeatureIds = existingExperiment.linkedFeatures;
            for (const linkedFeatureId of linkedFeatureIds) {
              const linkedFeature = featuresMap.get(linkedFeatureId);
              if (linkedFeature) {
                // Check if this feature has experiment-ref rules for this experiment
                const hasExperimentRef = Object.values(
                  linkedFeature.environmentSettings || {},
                ).some((envSettings) =>
                  envSettings.rules?.some(
                    (rule) =>
                      rule.type === "experiment-ref" &&
                      rule.experimentId === existingExperiment.id,
                  ),
                );
                if (hasExperimentRef) {
                  existingCompanionFeature = linkedFeature;
                  featureId = linkedFeature.id;
                  break;
                }
              }
            }
          }

          // If no existing companion feature found, check for ID conflicts
          if (!existingCompanionFeature) {
            const existingFeature = featuresMap.get(transformedFeature.id);
            featureId = existingFeature
              ? `exp_${transformedFeature.id}`
              : transformedFeature.id;
          }

          const featureRes: { feature: FeatureInterface } = await apiCall(
            `/feature/${featureId}/sync`,
            {
              method: "POST",
              body: JSON.stringify(transformedFeature),
            },
          );

          const experimentIsUpdate = !!existingExperiment;
          experiment.status = "completed";
          experiment.exists = experimentIsUpdate;
          experiment.gbExperiment = experimentRes.experiment;
          experiment.gbFeature = featureRes.feature;
          experiment.existingExperiment = existingExperiment;
          experiment.existingFeature =
            existingCompanionFeature || featureRes.feature;
        } catch (e) {
          console.warn("import experiment error", e);
          const experimentIsUpdate = !!experiment.existingExperiment;
          experiment.status = "failed";
          experiment.exists = experimentIsUpdate;
          experiment.error = e.message;

          // Clean up the feature if it was created but experiment failed
          if (featureId) {
            try {
              await apiCall(`/feature/${featureId}`, {
                method: "DELETE",
              });
            } catch (deleteError) {
              console.warn(
                `Failed to delete feature ${featureId} after experiment failure:`,
                deleteError,
              );
            }
          }
        }
        update();
      });
    }
  });
  await queue.onIdle();

  // Import Tags
  data.tags?.forEach((tagImport, index) => {
    if (
      canProcessItem(tagImport.status) &&
      shouldImportItem("tags", index, tagImport)
    ) {
      queue.add(async () => {
        // Reset status to pending when re-running
        tagImport.status = "pending";
        try {
          const tag = tagImport.tag as StatsigTag;
          if (!tag) {
            throw new Error("No tag data available");
          }

          // Create or update tag (POST endpoint handles upserts automatically)
          const tagPayload = {
            id: tag.name,
            description: tag.description || "",
            color: tag.isCore ? "purple" : "blue",
          };

          const isUpdate = !!tagImport.existingTag;
          const tagRes: TagInterface = await apiCall("/tag", {
            method: "POST",
            body: JSON.stringify(tagPayload),
          });

          tagImport.status = "completed";
          tagImport.exists = isUpdate;
          tagImport.gbTag = tagRes;
        } catch (e) {
          const isUpdate = !!tagImport.existingTag;
          tagImport.status = "failed";
          tagImport.exists = isUpdate;
          tagImport.error = e.message;
        }
        update();
      });
    }
  });
  await queue.onIdle();

  data.metricSources?.forEach((metricSourceImport, index) => {
    if (
      canProcessItem(metricSourceImport.status) &&
      shouldImportItem("metricSources", index, metricSourceImport)
    ) {
      queue.add(async () => {
        // Reset status to pending when re-running
        metricSourceImport.status = "pending";
        try {
          const metricSource = metricSourceImport.metricSource;
          if (!metricSource) {
            throw new Error("No metric source data available");
          }

          const factTablePayload =
            await transformStatsigMetricSourceToFactTable(
              metricSource,
              project || "",
              datasource,
            );

          const existingMetricSource = metricSourceImport.existingMetricSource;
          const isUpdate = !!existingMetricSource;

          // Create new fact table
          let id: string;
          if (existingMetricSource) {
            id = existingMetricSource.id;

            if (
              existingMetricSource.datasource !== factTablePayload.datasource
            ) {
              throw new Error(
                `Cannot change datasource of existing metric source "${existingMetricSource.name}". Please create a new metric source instead.`,
              );
            }

            const updatePayload = omit(factTablePayload, "datasource");

            // Update existing fact table
            await apiCall(`/fact-tables/${existingMetricSource.id}`, {
              method: "PUT",
              body: JSON.stringify(updatePayload),
            });
          } else {
            const res = await apiCall("/fact-tables", {
              method: "POST",
              body: JSON.stringify(factTablePayload),
            });
            id = res.factTable.id;
          }
          metricSourceIdMap.set(metricSource.name, id);

          metricSourceImport.status = "completed";
          metricSourceImport.exists = isUpdate;
        } catch (e) {
          const isUpdate = !!metricSourceImport.existingMetricSource;
          metricSourceImport.status = "failed";
          metricSourceImport.exists = isUpdate;
          metricSourceImport.error = e.message;
        }
        update();
      });
    }
  });
  await queue.onIdle();

  data.metrics?.forEach((metricImport, index) => {
    if (
      canProcessItem(metricImport.status) &&
      shouldImportItem("metrics", index, metricImport)
    ) {
      queue.add(async () => {
        // Reset status to pending when re-running
        metricImport.status = "pending";
        try {
          const metric = metricImport.metric;
          if (!metric) {
            throw new Error("No metric data available");
          }

          const metricPayload = await transformStatsigMetricToMetric(
            metric,
            metricSourceIdMap,
            project || "",
            datasource?.id || "",
          );

          const existingMetric = metricImport.existingMetric;
          const isUpdate = !!existingMetric;

          if (existingMetric) {
            // Update existing metric
            await apiCall(`/fact-metrics/${existingMetric.id}`, {
              method: "PUT",
              body: JSON.stringify(metricPayload),
            });
          } else {
            // Create new metric
            await apiCall("/fact-metrics", {
              method: "POST",
              body: JSON.stringify(metricPayload),
            });
          }

          metricImport.status = "completed";
          metricImport.exists = isUpdate;
        } catch (e) {
          const isUpdate = !!metricImport.existingMetric;
          metricImport.status = "failed";
          metricImport.exists = isUpdate;
          metricImport.error = e.message;
        }
        update();
      });
    }
  });
  await queue.onIdle();

  data.status = "completed";
  timer && clearTimeout(timer);
  callback(data);
}
