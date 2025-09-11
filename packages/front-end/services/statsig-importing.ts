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
  default_value: any;
  tags?: string[];
};

export type StatSigExperiment = {
  name: string;
  description?: string;
  status: 'draft' | 'running' | 'stopped';
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
  value: any;
  weight: number;
};

export type StatSigTargeting = {
  conditions?: StatSigCondition[];
  user_segments?: string[];
};

export type StatSigCondition = {
  type: string;
  targetValue: any;
  operator: string;
};

export type StatSigRule = {
  id: string;
  baseID: string;
  name: string;
  passPercentage: number;
  conditions: StatSigCondition[];
  environments?: any;
};

export type StatSigHoldout = {
  enabled: boolean;
  percentage: number;
};

export type StatSigSavedGroup = {
  name: string;
  description?: string;
  type: 'static' | 'dynamic';
  members?: string[];
  conditions?: StatSigCondition[];
};

export type StatSigAttribute = {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array';
  description?: string;
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
  method: string = 'GET',
): Promise<ResType> {
  const url = `https://statsigapi.net/console/v1/${endpoint}`;
  
  const fetchOptions: RequestInit = {
    method,
    headers: {
      'STATSIG-API-KEY': apiKey,
      'STATSIG-API-VERSION': '20240601',
      'Content-Type': 'application/json',
    },
  };

  const response = await fetch(url, fetchOptions);

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`StatSig Console API error (${url}): ${response.status} ${response.statusText} - ${errorText}`);
  }

  return response.json();
}


/**
 * Fetch feature gates (based on Console API endpoints)
 */
export const getStatSigFeatureGates = async (
  apiKey: string,
): Promise<StatSigFeatureGatesResponse> => {
  return getFromStatSig('gates', apiKey, 'GET');
};

/**
 * Fetch dynamic configs (based on Console API endpoints)
 */
export const getStatSigDynamicConfigs = async (
  apiKey: string,
): Promise<StatSigDynamicConfigsResponse> => {
  return getFromStatSig('dynamic_configs', apiKey, 'GET');
};

/**
 * Fetch experiments (based on Console API endpoints)
 */
export const getStatSigExperiments = async (
  apiKey: string,
): Promise<StatSigExperimentsResponse> => {
  return getFromStatSig('experiments', apiKey, 'GET');
};

/**
 * Fetch segments/saved groups (based on Console API endpoints)
 */
export const getStatSigSegments = async (
  apiKey: string,
): Promise<StatSigSavedGroupsResponse> => {
  return getFromStatSig('segments', apiKey, 'GET');
};

/**
 * Fetch layers (based on Console API endpoints)
 */
export const getStatSigLayers = async (
  apiKey: string,
): Promise<any> => {
  return getFromStatSig('layers', apiKey, 'GET');
};

/**
 * Fetch metrics (based on Console API endpoints)
 */
export const getStatSigMetrics = async (
  apiKey: string,
): Promise<any> => {
  return getFromStatSig('metrics/list', apiKey, 'GET');
};

/**
 * Fetch all pages for a given endpoint with rate limiting
 */
async function fetchAllPages(
  endpoint: string,
  apiKey: string,
  intervalCap: number = 50,
): Promise<any[]> {
  const PQueue = (await import('p-queue')).default;
  const queue = new PQueue({ interval: 10000, intervalCap: intervalCap });
  
  const allData: any[] = [];
  let pageNumber = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const response = await queue.add(async () => {
      return getFromStatSig(`${endpoint}?page=${pageNumber}`, apiKey, 'GET');
    }) as any;
    
    if (response.data && response.data.length > 0) {
      allData.push(...response.data);
    }

    // Check if there are more pages
    hasMorePages = response.pagination?.nextPage !== null;
    pageNumber++;
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
    featureGatesData,
    dynamicConfigsData,
    experimentsData,
    segmentsData,
    layersData,
    metricsData,
  ] = await Promise.all([
    fetchAllPages('gates', apiKey, intervalCap),
    fetchAllPages('dynamic_configs', apiKey, intervalCap),
    fetchAllPages('experiments', apiKey, intervalCap),
    fetchAllPages('segments', apiKey, intervalCap),
    fetchAllPages('layers', apiKey, intervalCap),
    fetchAllPages('metrics/list', apiKey, intervalCap),
  ]);

  return {
    featureGates: { data: featureGatesData },
    dynamicConfigs: { data: dynamicConfigsData },
    experiments: { data: experimentsData },
    segments: { data: segmentsData },
    layers: { data: layersData },
    metrics: { data: metricsData },
  };
};
