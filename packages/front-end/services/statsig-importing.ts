// StatSig importing utilities
// Based on StatSig Console API documentation

export type StatSigFeatureGate = {
  id: string;
  name: string;
  description?: string;
  isEnabled: boolean;
  status: string;
  rules: StatSigRule[];
  tags?: string[];
  owner?: {
    ownerID: string;
    ownerType: string;
    ownerName: string;
    ownerEmail: string;
  };
  lastModifiedTime: number;
  createdTime: number;
};

export type StatSigDynamicConfig = {
  name: string;
  description?: string;
  enabled: boolean;
  rules: StatSigRule[];
  default_value: unknown;
  tags?: string[];
};

export type StatSigExperiment = {
  name: string;
  description?: string;
  status: "draft" | "running" | "stopped";
  hypothesis?: string;
  primary_metric: string;
  secondary_metrics?: string[];
  variants: StatSigVariant[];
  targeting: StatSigTargeting;
  holdout?: StatSigHoldout;
};

export type StatSigVariant = {
  name: string;
  description?: string;
  value: unknown;
  weight: number;
};

export type StatSigTargeting = {
  conditions?: StatSigCondition[];
  user_segments?: string[];
};

export type StatSigCondition = {
  type: string;
  targetValue: unknown;
  operator: string;
};

export type StatSigRule = {
  id: string;
  baseID: string;
  name: string;
  passPercentage: number;
  conditions: StatSigCondition[];
  environments?: unknown;
};

export type StatSigHoldout = {
  enabled: boolean;
  percentage: number;
};

export type StatSigSavedGroup = {
  name: string;
  description?: string;
  type: "static" | "dynamic";
  members?: string[];
  conditions?: StatSigCondition[];
};

export type StatSigAttribute = {
  name: string;
  type: "string" | "number" | "boolean" | "array";
  description?: string;
};

export type StatSigEnvironment = {
  id: string;
  name: string;
  isProduction: boolean;
  requiresReview: boolean;
  requiresReleasePipeline: boolean;
};

// API Response types
export type StatSigFeatureGatesResponse = {
  gates: StatSigFeatureGate[];
};

export type StatSigDynamicConfigsResponse = {
  configs: StatSigDynamicConfig[];
};

export type StatSigExperimentsResponse = {
  experiments: StatSigExperiment[];
};

export type StatSigSavedGroupsResponse = {
  groups: StatSigSavedGroup[];
};

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

    console.log(`Page ${pageNumber} for ${endpoint}:`, {
      hasData: Array.isArray(response.data) ? response.data.length > 0 : false,
      dataLength: Array.isArray(response.data) ? response.data.length : 0,
      pagination: response.pagination,
      responseKeys: Object.keys(response),
    });

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
      console.log(
        `No data on page ${pageNumber}, stopping pagination for ${endpoint}`,
      );
      hasMorePages = false;
      break;
    }

    // Check if there are more pages based on pagination metadata
    if (response.pagination) {
      hasMorePages = response.pagination.nextPage !== null;
      console.log(
        `Pagination metadata found: nextPage=${response.pagination.nextPage}, hasMorePages=${hasMorePages}`,
      );
    } else {
      // If no pagination metadata, assume single page (most APIs return all data on first page)
      console.log(
        `No pagination metadata found, assuming single page for ${endpoint}`,
      );
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

  return {
    environments: { data: environmentsData },
    featureGates: { data: featureGatesData },
    dynamicConfigs: { data: dynamicConfigsData },
    experiments: { data: experimentsData },
    segments: { data: segmentsData },
    layers: { data: layersData },
    metrics: { data: metricsData },
  };
};
