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
 * Make a request to StatSig Console API via GrowthBook proxy
 */
async function getFromStatSig<ResType>(
  endpoint: string,
  apiKey: string,
  apiCall: (path: string, options?: any) => Promise<any>,
  method: string = 'GET',
): Promise<ResType> {
  return apiCall('/statsig-proxy', {
    method: 'POST',
    body: JSON.stringify({
      endpoint,
      apiKey,
      method,
    }),
  });
}


/**
 * Fetch feature gates (based on Console API endpoints)
 */
export const getStatSigFeatureGates = async (
  apiKey: string,
  apiCall: (path: string, options?: any) => Promise<any>,
): Promise<StatSigFeatureGatesResponse> => {
  return getFromStatSig('gates', apiKey, apiCall, 'GET');
};

/**
 * Fetch dynamic configs (based on Console API endpoints)
 */
export const getStatSigDynamicConfigs = async (
  apiKey: string,
  apiCall: (path: string, options?: any) => Promise<any>,
): Promise<StatSigDynamicConfigsResponse> => {
  return getFromStatSig('dynamic_configs', apiKey, apiCall, 'GET');
};

/**
 * Fetch experiments (based on Console API endpoints)
 */
export const getStatSigExperiments = async (
  apiKey: string,
  apiCall: (path: string, options?: any) => Promise<any>,
): Promise<StatSigExperimentsResponse> => {
  return getFromStatSig('experiments', apiKey, apiCall, 'GET');
};

/**
 * Fetch segments/saved groups (based on Console API endpoints)
 */
export const getStatSigSegments = async (
  apiKey: string,
  apiCall: (path: string, options?: any) => Promise<any>,
): Promise<StatSigSavedGroupsResponse> => {
  return getFromStatSig('segments', apiKey, apiCall, 'GET');
};

/**
 * Fetch layers (based on Console API endpoints)
 */
export const getStatSigLayers = async (
  apiKey: string,
  apiCall: (path: string, options?: any) => Promise<any>,
): Promise<any> => {
  return getFromStatSig('layers', apiKey, apiCall, 'GET');
};

/**
 * Fetch metrics (based on Console API endpoints)
 */
export const getStatSigMetrics = async (
  apiKey: string,
  apiCall: (path: string, options?: any) => Promise<any>,
): Promise<any> => {
  return getFromStatSig('metrics/list', apiKey, apiCall, 'GET');
};

/**
 * Fetch all pages for a given endpoint with rate limiting
 */
async function fetchAllPages(
  endpoint: string,
  apiKey: string,
  apiCall: (path: string, options?: any) => Promise<any>,
  intervalCap: number = 50,
): Promise<any[]> {
  const PQueue = (await import('p-queue')).default;
  const queue = new PQueue({ interval: 10000, intervalCap: intervalCap });
  
  const allData: any[] = [];
  let pageNumber = 1;
  let hasMorePages = true;

  while (hasMorePages) {
    const response = await queue.add(async () => {
      return getFromStatSig(`${endpoint}?page=${pageNumber}`, apiKey, apiCall, 'GET');
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
  apiCall: (path: string, options?: any) => Promise<any>,
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
    fetchAllPages('gates', apiKey, apiCall, intervalCap),
    fetchAllPages('dynamic_configs', apiKey, apiCall, intervalCap),
    fetchAllPages('experiments', apiKey, apiCall, intervalCap),
    fetchAllPages('segments', apiKey, apiCall, intervalCap),
    fetchAllPages('layers', apiKey, apiCall, intervalCap),
    fetchAllPages('metrics/list', apiKey, apiCall, intervalCap),
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
