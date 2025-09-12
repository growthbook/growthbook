import { FeatureInterface } from "back-end/types/feature";
import { Environment } from "back-end/types/organization";
import { SavedGroupInterface } from "shared/src/types";
import { cloneDeep } from "lodash";
import {
  StatSigFeatureGate,
  StatSigDynamicConfig,
  StatSigExperiment,
  StatSigSavedGroup,
  StatSigEnvironment,
  StatSigFeatureGatesResponse,
  StatSigDynamicConfigsResponse,
  StatSigExperimentsResponse,
  StatSigSavedGroupsResponse,
  ImportData,
} from "./types";
import { transformStatSigSegmentToSavedGroup } from "./transformers/savedGroupTransformer";
import { transformStatSigFeatureGateToGB } from "./transformers/featureTransformer";

/**
 * Make a direct request to StatSig Console API
 */
async function getFromStatSig<ResType>(
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
      `StatSig Console API error (${url}): ${response.status} ${response.statusText} - ${errorText}`,
    );
  }

  return response.json();
}

/**
 * Fetch feature gates (based on Console API endpoints)
 */
export const getStatSigFeatureGates = async (
  apiKey: string,
): Promise<StatSigFeatureGatesResponse> => {
  return getFromStatSig("gates", apiKey, "GET");
};

/**
 * Fetch dynamic configs (based on Console API endpoints)
 */
export const getStatSigDynamicConfigs = async (
  apiKey: string,
): Promise<StatSigDynamicConfigsResponse> => {
  return getFromStatSig("dynamic_configs", apiKey, "GET");
};

/**
 * Fetch experiments (based on Console API endpoints)
 */
export const getStatSigExperiments = async (
  apiKey: string,
): Promise<StatSigExperimentsResponse> => {
  return getFromStatSig("experiments", apiKey, "GET");
};

/**
 * Fetch segments/saved groups (based on Console API endpoints)
 */
export const getStatSigSegments = async (
  apiKey: string,
): Promise<StatSigSavedGroupsResponse> => {
  return getFromStatSig("segments", apiKey, "GET");
};

/**
 * Fetch ID list for a specific segment
 */
export const getStatSigSegmentIdList = async (
  apiKey: string,
  segmentId: string,
): Promise<{ data: { name: string; count: number; ids: string[] } }> => {
  return getFromStatSig(`segments/${segmentId}/id_list`, apiKey, "GET");
};

/**
 * Fetch layers (based on Console API endpoints)
 */
export const getStatSigLayers = async (apiKey: string): Promise<unknown> => {
  return getFromStatSig("layers", apiKey, "GET");
};

/**
 * Fetch metrics (based on Console API endpoints)
 */
export const getStatSigMetrics = async (apiKey: string): Promise<unknown> => {
  return getFromStatSig("metrics/list", apiKey, "GET");
};

/**
 * Fetch environments (based on Console API endpoints)
 */
export const getStatSigEnvironments = async (
  apiKey: string,
): Promise<unknown> => {
  return getFromStatSig("environments", apiKey, "GET");
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
      return getFromStatSig(`${endpoint}?page=${pageNumber}`, apiKey, "GET");
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
      } else if (dataObj.layers && Array.isArray(dataObj.layers)) {
        dataArray = dataObj.layers;
      } else if (dataObj.metrics && Array.isArray(dataObj.metrics)) {
        dataArray = dataObj.metrics;
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
export const getAllStatSigEntities = async (
  apiKey: string,
  intervalCap: number = 50,
) => {
  const [
    environmentsData,
    featureGatesData,
    dynamicConfigsData,
    experimentsData,
    segmentsData,
    layersData,
    metricsData,
  ] = await Promise.all([
    fetchAllPages("environments", apiKey, intervalCap),
    fetchAllPages("gates", apiKey, intervalCap),
    fetchAllPages("dynamic_configs", apiKey, intervalCap),
    fetchAllPages("experiments", apiKey, intervalCap),
    fetchAllPages("segments", apiKey, intervalCap),
    fetchAllPages("layers", apiKey, intervalCap),
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
    layers: { data: layersData },
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
      const seg = segment as StatSigSavedGroup;

      // If this is an id_list type segment, fetch the ID list
      if (seg.type === "id_list") {
        try {
          const idListData = await queue.add(async () => {
            return getStatSigSegmentIdList(apiKey, seg.id);
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
 * Build imported data from StatSig entities
 */
export async function buildImportedData(
  apiKey: string,
  intervalCap: number,
  features: FeatureInterface[],
  existingEnvironments: Set<string>,
  existingSavedGroups: Set<string>,
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
  }>,
  apiCall: (path: string, options?: unknown) => Promise<unknown>,
  callback: (data: ImportData) => void,
): Promise<void> {
  const data: ImportData = {
    status: "fetching",
    environments: [],
    featureGates: [],
    dynamicConfigs: [],
    experiments: [],
    segments: [],
    layers: [],
    metrics: [],
  };

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
        const entities = await getAllStatSigEntities(apiKey, intervalCap);

        // Process environments
        // Note: environments.data is an array of environment objects, not nested
        entities.environments.data.forEach((environment) => {
          const env = environment as StatSigEnvironment;
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

        // Process feature gates
        const featuresMap = new Map(features.map((f) => [f.id, f]));
        entities.featureGates.data.forEach((gate) => {
          const fg = gate as StatSigFeatureGate;
          data.featureGates?.push({
            key: fg.name,
            status: featuresMap.has(fg.name) ? "skipped" : "pending",
            featureGate: fg,
            error: featuresMap.has(fg.name)
              ? "Feature already exists"
              : undefined,
          });
        });

        // Process dynamic configs
        entities.dynamicConfigs.data.forEach((config) => {
          const dc = config as StatSigDynamicConfig;
          data.dynamicConfigs?.push({
            key: dc.name,
            status: "pending",
            dynamicConfig: dc,
          });
        });

        // Process experiments
        entities.experiments.data.forEach((experiment) => {
          const exp = experiment as StatSigExperiment;
          data.experiments?.push({
            key: exp.name,
            status: "pending",
            experiment: exp,
          });
        });

        // Process segments
        entities.segments.data.forEach((segment) => {
          const seg = segment as StatSigSavedGroup;
          data.segments?.push({
            key: seg.id,
            status: existingSavedGroups.has(seg.id) ? "skipped" : "pending",
            segment: seg,
            error: existingSavedGroups.has(seg.id)
              ? "Saved group already exists"
              : undefined,
          });
        });

        // Process layers
        entities.layers.data.forEach((layer) => {
          const l = layer as { name?: string; id?: string };
          data.layers?.push({
            key: l.name || l.id || "unknown",
            status: "pending",
            layer: layer,
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
        console.error(`Error fetching entities from StatSig:`, e);
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
  }
}

/**
 * Run the import process
 */
export async function runImport(
  data: ImportData,
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
  }>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  apiCall: (path: string, options?: any) => Promise<any>,
  callback: (data: ImportData) => void,
) {
  // We will mutate this shared object and sync it back to the component periodically
  data = cloneDeep(data);

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

  const PQueue = (await import("p-queue")).default;
  const queue = new PQueue({ concurrency: 6 });

  // Import Environments in a single API call
  queue.add(async () => {
    const envsToAdd: Environment[] = [];
    data.environments?.forEach((e) => {
      if (e.status === "pending" && e.environment) {
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
  data.segments?.forEach((segment) => {
    if (segment.status === "pending") {
      queue.add(async () => {
        try {
          const seg = segment.segment as StatSigSavedGroup;

          // Transform StatSig segment to GrowthBook saved group
          const savedGroupData = await transformStatSigSegmentToSavedGroup(
            seg,
            existingAttributeSchema,
            apiCall,
          );

          const res: { savedGroup: SavedGroupInterface } = await apiCall(
            "/saved-groups",
            {
              method: "POST",
              body: JSON.stringify(savedGroupData),
            },
          );

          segment.status = "completed";
          segment.segment = res.savedGroup as unknown as StatSigSavedGroup;
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
  data.featureGates?.forEach((featureGate) => {
    if (featureGate.status === "pending") {
      queue.add(async () => {
        try {
          const fg = featureGate.featureGate as StatSigFeatureGate;
          if (!fg) {
            throw new Error("No feature gate data available");
          }

          // Transform StatSig feature gate to GrowthBook feature
          // Get available environments from the processed data
          const availableEnvironments =
            data.environments
              ?.map((e) => e.environment?.name || e.key)
              .filter(Boolean) || [];
          const transformedFeature = await transformStatSigFeatureGateToGB(
            fg,
            availableEnvironments,
            existingAttributeSchema,
            apiCall,
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

  // For now, just mark everything else as completed since we're only implementing environments, segments, and feature gates

  data.dynamicConfigs?.forEach((config) => {
    if (config.status === "pending") {
      config.status = "failed";
      config.error = "Not implemented yet";
    }
  });

  data.experiments?.forEach((exp) => {
    if (exp.status === "pending") {
      exp.status = "failed";
      exp.error = "Not implemented yet";
    }
  });

  data.layers?.forEach((layer) => {
    if (layer.status === "pending") {
      layer.status = "failed";
      layer.error = "Not implemented yet";
    }
  });

  data.metrics?.forEach((metric) => {
    if (metric.status === "pending") {
      metric.status = "failed";
      metric.error = "Not implemented yet";
    }
  });

  data.status = "completed";
  timer && clearTimeout(timer);
  callback(data);
}
