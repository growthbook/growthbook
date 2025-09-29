import { FeatureInterface } from "back-end/types/feature";
import { Environment } from "back-end/types/organization";
import { SavedGroupInterface } from "shared/src/types";
import { TagInterface } from "back-end/types/tag";
import { cloneDeep } from "lodash";
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
} from "./types";
import { transformStatsigSegmentToSavedGroup } from "./transformers/savedGroupTransformer";
import { transformStatsigFeatureGateToGB } from "./transformers/featureTransformer";
import { transformStatsigExperimentToGB } from "./transformers/experimentTransformer";
import { transformStatsigExperimentToFeature } from "./transformers/experimentRefFeatureTransformer";

// Options interfaces for function parameters
export interface BuildImportedDataOptions {
  apiKey: string;
  intervalCap: number;
  features: FeatureInterface[];
  existingEnvironments: Set<string>;
  existingSavedGroups: Set<string>;
  existingTags: Set<string>;
  existingExperiments: Set<string>;
  callback: (data: ImportData) => void;
  skipAttributeMapping?: boolean;
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
  apiCall: (path: string, options?: any) => Promise<any>;
  callback: (data: ImportData) => void;
  featuresMap: Map<string, FeatureInterface>;
  project?: string;
  datasource?: string;
  exposureQueryId?: string;
  categoryEnabled?: {
    environments: boolean;
    tags: boolean;
    segments: boolean;
    featureGates: boolean;
    dynamicConfigs: boolean;
    experiments: boolean;
    metrics: boolean;
  };
  itemEnabled?: {
    [category: string]: { [key: string]: boolean };
  };
  skipAttributeMapping?: boolean;
}

/**
 * Make a direct request to Statsig Console API
 */
async function getFromStatsig<ResType>(
  endpoint: string,
  apiKey: string,
  method: string = "GET",
): Promise<ResType> {
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
): Promise<StatsigFeatureGatesResponse> => {
  return getFromStatsig("gates", apiKey, "GET");
};

/**
 * Fetch dynamic configs (based on Console API endpoints)
 */
export const getStatsigDynamicConfigs = async (
  apiKey: string,
): Promise<StatsigDynamicConfigsResponse> => {
  return getFromStatsig("dynamic_configs", apiKey, "GET");
};

/**
 * Fetch experiments (based on Console API endpoints)
 */
export const getStatsigExperiments = async (
  apiKey: string,
): Promise<StatsigExperimentsResponse> => {
  return getFromStatsig("experiments", apiKey, "GET");
};

/**
 * Fetch segments/saved groups (based on Console API endpoints)
 */
export const getStatsigSegments = async (
  apiKey: string,
): Promise<StatsigSavedGroupsResponse> => {
  return getFromStatsig("segments", apiKey, "GET");
};

/**
 * Fetch ID list for a specific segment
 */
export const getStatsigSegmentIdList = async (
  apiKey: string,
  segmentId: string,
): Promise<{ data: { name: string; count: number; ids: string[] } }> => {
  return getFromStatsig(`segments/${segmentId}/id_list`, apiKey, "GET");
};

/**
 * Fetch tags (based on Console API endpoints)
 */
export const getStatsigTags = async (apiKey: string): Promise<unknown> => {
  return getFromStatsig("tags", apiKey, "GET");
};

/**
 * Fetch metrics (based on Console API endpoints)
 */
export const getStatsigMetrics = async (apiKey: string): Promise<unknown> => {
  return getFromStatsig("metrics/list", apiKey, "GET");
};

/**
 * Fetch environments (based on Console API endpoints)
 */
export const getStatsigEnvironments = async (
  apiKey: string,
): Promise<unknown> => {
  return getFromStatsig("environments", apiKey, "GET");
};

/**
 * Fetch all pages for a given endpoint with rate limiting
 */
async function fetchAllPages(
  endpoint: string,
  apiKey: string,
  intervalCap: number = 50,
): Promise<unknown[]> {
  const PQueue = (await import("p-queue")).default;
  const queue = new PQueue({ interval: 10000, intervalCap: intervalCap });

  const allData: unknown[] = [];
  let pageNumber = 1;
  let hasMorePages = true;
  const maxPages = 50; // Safety limit to prevent infinite loops

  while (hasMorePages && pageNumber <= maxPages) {
    const response = (await queue.add(async () => {
      return getFromStatsig(`${endpoint}?page=${pageNumber}`, apiKey, "GET");
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
) => {
  const [
    environmentsData,
    featureGatesData,
    dynamicConfigsData,
    experimentsData,
    segmentsData,
    tagsData,
    metricsData,
  ] = await Promise.all([
    fetchAllPages("environments", apiKey, intervalCap),
    fetchAllPages("gates", apiKey, intervalCap),
    fetchAllPages("dynamic_configs", apiKey, intervalCap),
    fetchAllPages("experiments", apiKey, intervalCap),
    fetchAllPages("segments", apiKey, intervalCap),
    fetchAllPages("tags", apiKey, intervalCap),
    fetchAllPages("metrics/list", apiKey, intervalCap),
  ]);

  // Process segments to fetch ID lists for id_list type segments
  const processedSegmentsData = await processSegmentsWithIdLists(
    segmentsData,
    apiKey,
    intervalCap,
  );

  return {
    environments: { data: environmentsData },
    featureGates: { data: featureGatesData },
    dynamicConfigs: { data: dynamicConfigsData },
    experiments: { data: experimentsData },
    segments: { data: processedSegmentsData },
    tags: { data: tagsData },
    metrics: { data: metricsData },
  };
};

/**
 * Process segments to fetch ID lists for segments with type "id_list"
 */
async function processSegmentsWithIdLists(
  segmentsData: unknown[],
  apiKey: string,
  intervalCap: number,
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
            return getStatsigSegmentIdList(apiKey, seg.id);
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
    callback,
  } = options;
  const data: ImportData = {
    status: "fetching",
    environments: [],
    featureGates: [],
    dynamicConfigs: [],
    experiments: [],
    segments: [],
    tags: [],
    metrics: [],
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
        const entities = await getAllStatsigEntities(apiKey, intervalCap);

        // Process environments
        // Note: environments.data is an array of environment objects, not nested
        entities.environments.data.forEach((environment) => {
          const env = environment as StatsigEnvironment;
          const envKey = env.name || env.id;
          data.environments?.push({
            key: envKey,
            status: existingEnvironments.has(envKey) ? "skipped" : "pending",
            environment: env,
            error: existingEnvironments.has(envKey)
              ? "Environment already exists"
              : undefined,
          });
        });

        // Process segments
        entities.segments.data.forEach((segment) => {
          const seg = segment as StatsigSavedGroup;
          data.segments?.push({
            key: seg.id,
            status: existingSavedGroups.has(seg.id) ? "skipped" : "pending",
            segment: seg,
            error: existingSavedGroups.has(seg.id)
              ? "Saved group already exists"
              : undefined,
          });
        });

        // Process feature gates
        featuresMap = new Map(features.map((f) => [f.id, f]));
        entities.featureGates.data.forEach((gate) => {
          const fg = gate as StatsigFeatureGate;
          data.featureGates?.push({
            key: fg.id, // Use ID instead of name for uniqueness
            status: featuresMap.has(fg.id) ? "skipped" : "pending",
            featureGate: fg,
            error: featuresMap.has(fg.id)
              ? "Feature already exists"
              : undefined,
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
            status: featuresMap.has(dc.id) ? "skipped" : "pending",
            dynamicConfig: dc,
            error: featuresMap.has(dc.id)
              ? "Feature already exists"
              : undefined,
          });
        });

        // Process experiments
        entities.experiments.data.forEach((experiment) => {
          const exp = experiment as StatsigExperiment;
          data.experiments?.push({
            key: exp.name,
            status: existingExperiments.has(exp.id) ? "skipped" : "pending",
            experiment: exp,
            error: existingExperiments.has(exp.id)
              ? "Experiment already exists"
              : undefined,
          });
        });

        // Process tags
        entities.tags.data.forEach((tag) => {
          const t = tag as StatsigTag;
          data.tags?.push({
            key: t.name, // Use name as key since that's what becomes the GB tag ID
            status: existingTags.has(t.name) ? "skipped" : "pending",
            tag: t,
            error: existingTags.has(t.name) ? "Tag already exists" : undefined,
          });
        });

        // Process metrics
        entities.metrics.data.forEach((metric) => {
          const m = metric as { name?: string; id?: string };
          data.metrics?.push({
            key: m.name || m.id || "unknown",
            status: "pending",
            metric: metric,
          });
        });

        update();
      } catch (e) {
        console.error(`Error fetching entities from Statsig:`, e);
      }
    });

    await queue.onIdle();
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
      return itemEnabled[category][key] !== false; // Default to true if not explicitly set
    }

    return true; // Default to importing if no checkbox state
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
        return `metric-${item.metric?.name || item.metric?.id || index}`;
      default:
        return `${category}-${index}`;
    }
  };

  const PQueue = (await import("p-queue")).default;
  const queue = new PQueue({ concurrency: 6 });

  // Import Environments in a single API call
  queue.add(async () => {
    const envsToAdd: Environment[] = [];
    data.environments?.forEach((e, index) => {
      if (
        e.status === "pending" &&
        e.environment &&
        shouldImportItem("environments", index, e)
      ) {
        envsToAdd.push({
          id: e.environment.name,
          description: e.environment.name,
        });
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
        data.environments?.forEach((env) => {
          if (env.status === "pending") {
            env.status = "completed";
          }
        });
      } catch (e) {
        data.environments?.forEach((env) => {
          if (env.status === "pending") {
            env.status = "failed";
            env.error = e.message;
          }
        });
      }
    }
    update();
  });
  await queue.onIdle();

  // Import Saved Groups (Segments)
  data.segments?.forEach((segment, index) => {
    if (
      segment.status === "pending" &&
      shouldImportItem("segments", index, segment)
    ) {
      queue.add(async () => {
        try {
          const seg = segment.segment as StatsigSavedGroup;

          // Transform Statsig segment to GrowthBook saved group
          const savedGroupData = await transformStatsigSegmentToSavedGroup(
            seg,
            existingAttributeSchema,
            apiCall,
            project,
            skipAttributeMapping,
          );

          const res: { savedGroup: SavedGroupInterface } = await apiCall(
            "/saved-groups",
            {
              method: "POST",
              body: JSON.stringify(savedGroupData),
            },
          );

          segment.status = "completed";
          segment.segment = res.savedGroup as unknown as StatsigSavedGroup;
        } catch (e) {
          segment.status = "failed";
          segment.error = e.message;
        }
        update();
      });
    }
  });
  await queue.onIdle();

  // Import Feature Gates
  data.featureGates?.forEach((featureGate, index) => {
    if (
      featureGate.status === "pending" &&
      shouldImportItem("featureGates", index, featureGate)
    ) {
      queue.add(async () => {
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
          );

          const res: { feature: FeatureInterface } = await apiCall(
            `/feature/${featureGate.key}/sync`,
            {
              method: "POST",
              body: JSON.stringify(transformedFeature),
            },
          );

          featureGate.status = "completed";
          featureGate.existing = res.feature;
        } catch (e) {
          featureGate.status = "failed";
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
      dynamicConfig.status === "pending" &&
      shouldImportItem("dynamicConfigs", index, dynamicConfig)
    ) {
      queue.add(async () => {
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
          );

          const res: { feature: FeatureInterface } = await apiCall(
            `/feature/${dynamicConfig.key}/sync`,
            {
              method: "POST",
              body: JSON.stringify(transformedFeature),
            },
          );

          dynamicConfig.status = "completed";
          dynamicConfig.existing = res.feature;
        } catch (e) {
          dynamicConfig.status = "failed";
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
      experiment.status === "pending" &&
      shouldImportItem("experiments", index, experiment)
    ) {
      queue.add(async () => {
        let featureId: string | null = null;
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
          );

          // Set project and datasource (will be provided by the importer)
          transformedExperiment.project = project || "";
          transformedExperiment.datasource = datasource || "";
          transformedExperiment.exposureQueryId = exposureQueryId || "";

          // Create the experiment first
          const experimentRes = await apiCall(`/experiments`, {
            method: "POST",
            body: JSON.stringify(transformedExperiment),
          });

          // Check if experiment creation was successful
          if (
            !experimentRes ||
            (typeof experimentRes === "object" &&
              "status" in experimentRes &&
              experimentRes.status >= 400)
          ) {
            throw new Error(
              `Experiment creation failed: ${experimentRes?.message || "Unknown error"}`,
            );
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
          );

          // Check for duplicate feature ID and add prefix if needed
          const existingFeature = featuresMap.get(transformedFeature.id);
          featureId = existingFeature
            ? `exp_${transformedFeature.id}`
            : transformedFeature.id;

          const featureRes: { feature: FeatureInterface } = await apiCall(
            `/feature/${featureId}/sync`,
            {
              method: "POST",
              body: JSON.stringify(transformedFeature),
            },
          );

          experiment.status = "completed";
          experiment.gbExperiment = experimentRes.experiment;
          experiment.gbFeature = featureRes.feature;
          experiment.existingExperiment = experimentRes.experiment;
          experiment.existingFeature = featureRes.feature;
        } catch (e) {
          console.log("import experiment error", e);
          experiment.status = "failed";
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
      tagImport.status === "pending" &&
      shouldImportItem("tags", index, tagImport)
    ) {
      queue.add(async () => {
        try {
          const tag = tagImport.tag as StatsigTag;
          if (!tag) {
            throw new Error("No tag data available");
          }

          // Create new tag
          const tagPayload = {
            id: tag.name,
            description: tag.description || "",
            color: tag.isCore ? "purple" : "blue",
          };

          const tagRes: TagInterface = await apiCall("/tag", {
            method: "POST",
            body: JSON.stringify(tagPayload),
          });

          tagImport.status = "completed";
          tagImport.gbTag = tagRes;
        } catch (e) {
          tagImport.status = "failed";
          tagImport.error = e.message;
        }
        update();
      });
    }
  });
  await queue.onIdle();

  data.metrics?.forEach((metric, index) => {
    if (
      metric.status === "pending" &&
      shouldImportItem("metrics", index, metric)
    ) {
      metric.status = "failed";
      metric.error = "Not implemented yet";
    }
  });

  data.status = "completed";
  timer && clearTimeout(timer);
  callback(data);
}
