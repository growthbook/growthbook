import { z } from "zod";
import { MetricInterface, MetricType } from "back-end/types/metric";

// Statsig Metric data structure
export interface StatsigMetricData {
  id: string;
  name: string;
  description?: string;
  type: "count" | "ratio" | "duration" | "revenue";
  unit?: string;
  tags?: string[];
  owner: {
    ownerID: string;
    ownerType: string;
    ownerName: string;
    ownerEmail: string;
  };
  createdTime: number;
  lastModifiedTime: number;
  lastModifierEmail: string;
  lastModifierID: string;
  lastModifierName: string;
  // Metric-specific fields
  numerator?: {
    eventName: string;
    valueProperty?: string;
    filters?: Array<{
      property: string;
      operator: string;
      value: any;
    }>;
  };
  denominator?: {
    eventName: string;
    valueProperty?: string;
    filters?: Array<{
      property: string;
      operator: string;
      value: any;
    }>;
  };
  // SQL query if available
  sql?: string;
  // Data source information
  datasource?: string;
  // Window settings
  conversionWindow?: {
    value: number;
    unit: "hours" | "days";
  };
  // Capping settings
  capping?: {
    type: "none" | "absolute" | "percentile";
    value?: number;
  };
}

/**
 * Converts Statsig metric data to GrowthBook metric format
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param datasourceId - The GrowthBook datasource ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Partial MetricInterface ready for creation
 */
export function convertStatsigMetricToGrowthBook(
  statsigData: any,
  organizationId: string,
  datasourceId: string,
  projectId?: string
): Omit<MetricInterface, "id" | "dateCreated" | "dateUpdated"> {
  console.log("Converting Statsig metric to GrowthBook format:", JSON.stringify(statsigData, null, 2));
  
  // Extract all possible field names for each property
  const extractField = (fieldNames: string[], defaultValue: any = "") => {
    for (const fieldName of fieldNames) {
      if (statsigData[fieldName] !== undefined && statsigData[fieldName] !== null) {
        return statsigData[fieldName];
      }
    }
    return defaultValue;
  };

  // Map Statsig metric types to GrowthBook metric types
  const statsigToGrowthBookTypeMap: Record<string, MetricType> = {
    // Event-based metrics
    "event_count_custom": "count",
    "event_count": "count",
    "count": "count",
    
    // User-based metrics
    "user": "count",
    "user_count": "count",
    "unique_users": "count",
    
    // Aggregation metrics - map to count for now since ratio is not a valid MetricType
    "mean": "count",
    "average": "count",
    "sum": "count",
    "aggregation": "count",
    
    // Ratio metrics - map to count for now since ratio is not a valid MetricType
    "ratio": "count",
    "rate": "count",
    "conversion_rate": "count",
    
    // Duration metrics
    "duration": "duration",
    "time": "duration",
    "session_duration": "duration",
    
    // Revenue metrics
    "revenue": "revenue",
    "monetary": "revenue",
    "value": "revenue",
    
    // Funnel metrics - map to count for now since ratio is not a valid MetricType
    "funnel": "count",
    "conversion": "count",
    
    // Count distinct
    "count_distinct": "count",
    "distinct": "count"
  };

  // Extract basic fields with multiple possible names
  const id = extractField(['id', 'metricName', 'name', 'metric_id', 'metricId'], 'unknown_metric');
  const name = extractField(['name', 'metricName', 'id', 'metric_id', 'metricId'], id);
  const description = extractField(['description', 'desc', 'summary'], '');
  const originalType = extractField(['type', 'metricType', 'metric_type', 'kind'], 'count');
  const metricType = statsigToGrowthBookTypeMap[originalType] || "count";
  
  // Extract owner information
  const owner = extractField(['owner', 'createdBy', 'creator', 'author'], {});
  const ownerEmail = owner.ownerEmail || owner.email || owner.userID || owner.userId || 'unknown@example.com';
  
  // Extract tags
  const tags = extractField(['tags', 'tag', 'labels', 'categories'], []);
  
  // Extract SQL or build it
  let sql = extractField(['sql', 'query', 'sqlQuery', 'queryString', 'definition']);
  
  if (!sql) {
    // Try to extract event information
    const eventName = extractField([
      'eventName', 'event_name', 'event', 'eventType', 'event_type',
      'numerator.eventName', 'numerator.event_name', 'numerator.event',
      'numeratorEvent', 'numerator_event'
    ]);
    
    const denominatorEvent = extractField([
      'denominator.eventName', 'denominator.event_name', 'denominator.event',
      'denominatorEvent', 'denominator_event'
    ]);
    
    if (eventName) {
      if (denominatorEvent && originalType === "ratio") {
        // Ratio metric
        sql = `
          SELECT 
            user_id,
            COUNT(CASE WHEN event = '${eventName}' THEN 1 END) as numerator_count,
            COUNT(CASE WHEN event = '${denominatorEvent}' THEN 1 END) as denominator_count
          FROM events 
          WHERE event IN ('${eventName}', '${denominatorEvent}')
          GROUP BY user_id
        `;
      } else {
        // Count metric
        sql = `
          SELECT 
            user_id,
            COUNT(*) as count
          FROM events 
          WHERE event = '${eventName}'
          GROUP BY user_id
        `;
      }
    } else {
      // Create a basic SQL template using the metric name
      sql = `
        SELECT 
          user_id,
          COUNT(*) as count
        FROM events 
        WHERE event = '${name}'
        GROUP BY user_id
      `;
    }
  }

  // Extract conversion window settings
  const conversionWindow = extractField(['conversionWindow', 'conversion_window', 'window', 'timeWindow'], {});
  const conversionWindowHours = conversionWindow.unit === "days" 
    ? (conversionWindow.value || 3) * 24 
    : conversionWindow.value || 72; // Default 72 hours

  // Extract capping settings
  const capping = extractField(['capping', 'cap', 'limits'], {});
  const cappingSettings = {
    type: (capping.type === "absolute" ? "absolute" : 
          capping.type === "percentile" ? "percentile" : "") as "" | "absolute" | "percentile",
    value: capping.value || 0,
  };

  // Extract denominator event name
  const denominatorEvent = extractField([
    'denominator.eventName', 'denominator.event_name', 'denominator.event',
    'denominatorEvent', 'denominator_event'
  ]);

  const metric: Omit<MetricInterface, "id" | "dateCreated" | "dateUpdated"> = {
    organization: organizationId,
    datasource: datasourceId,
    name: name,
    description: description,
    type: metricType,
    owner: ownerEmail,
    tags: Array.isArray(tags) ? tags : [],
    projects: projectId ? [projectId] : [],
    sql: sql,
    templateVariables: {},
    segment: "",
    denominator: denominatorEvent || undefined,
    inverse: false,
    aggregation: "sum",
    ignoreNulls: false,
    earlyStart: false,
    cappingSettings,
    windowSettings: {
      type: "conversion",
      delayValue: 0,
      delayUnit: "hours",
      windowValue: conversionWindowHours,
      windowUnit: "hours",
    },
    priorSettings: {
      override: false,
      proper: false,
      mean: 0,
      stddev: 0.5,
    },
    winRisk: 0.05,
    loseRisk: 0.05,
    maxPercentChange: 0.5,
    minPercentChange: 0.01,
    minSampleSize: 100,
    targetMDE: 0.05,
    regressionAdjustmentOverride: false,
    regressionAdjustmentEnabled: false,
    regressionAdjustmentDays: 14,
    queries: [],
    runStarted: null,
    analysis: undefined,
    analysisError: undefined,
    table: "",
    column: "",
    timestampColumn: "",
    conditions: [],
    queryFormat: "sql",
  };

  return metric;
}

/**
 * Validates the input Statsig metric data before conversion
 * @param data - The input data to validate
 * @returns Validation result with success/error information
 */
export function validateStatsigMetricData(data: any): { success: boolean; error?: string } {
  try {
    console.log("Validating Statsig metric data:", JSON.stringify(data, null, 2));
    
    // For internal API, we'll be very permissive and accept any metric data
    // The goal is to import whatever Statsig sends us and convert it appropriately
    
    // Basic check - just need some identifier
    if (!data.id && !data.metricName && !data.name && !data.metric_id && !data.metricId) {
      return { success: false, error: "Missing required field: id, metricName, name, metric_id, or metricId" };
    }
    
    // Everything else is optional - we'll handle missing fields in the conversion
    console.log("Metric validation passed - accepting flexible data structure");
    return { success: true };
  } catch (error) {
    return { success: false, error: `Validation error: ${error.message}` };
  }
}

/**
 * Helper function to convert a complete Statsig metric with validation
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param datasourceId - The GrowthBook datasource ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Conversion result with success/error information and converted data
 */
export function convertStatsigMetric(
  statsigData: any,
  organizationId: string,
  datasourceId: string,
  projectId?: string
): { success: boolean; data?: Omit<MetricInterface, "id" | "dateCreated" | "dateUpdated">; error?: string } {
  // Validate input data first
  const validation = validateStatsigMetricData(statsigData);
  if (!validation.success) {
    return { success: false, error: validation.error };
  }

  try {
    const convertedData = convertStatsigMetricToGrowthBook(statsigData, organizationId, datasourceId, projectId);
    return { success: true, data: convertedData };
  } catch (error) {
    return { success: false, error: `Conversion error: ${error.message}` };
  }
}
