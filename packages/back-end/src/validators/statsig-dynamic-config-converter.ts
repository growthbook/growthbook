import { FeatureInterface, FeatureRule, FeatureEnvironment } from "./features";

// Statsig Dynamic Config data structure
export interface StatsigDynamicConfigData {
  id: string;
  name: string;
  description?: string;
  type: "dynamic_config";
  configType: "dynamic_config";
  value: Record<string, any>;
  defaultValue: Record<string, any>;
  rules: Array<{
    id: string;
    name?: string;
    description?: string;
    condition: string;
    value: Record<string, any>;
    passPercentage?: number;
    salt?: string;
    idType?: string;
    isDeviceBased?: boolean;
  }>;
  owner: {
    ownerID: string;
    ownerType: string;
    ownerName: string;
    ownerEmail: string;
  };
  tags?: string[];
  createdTime: number;
  lastModifiedTime: number;
  lastModifierEmail: string;
  lastModifierID: string;
  lastModifierName: string;
  environment: string;
  status: "active" | "inactive";
  isActive: boolean;
}

/**
 * Converts Statsig dynamic config data to GrowthBook feature format
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Partial FeatureInterface ready for creation
 */
export function convertStatsigDynamicConfigToGrowthBook(
  statsigData: any,
  organizationId: string,
  projectId?: string
): Omit<FeatureInterface, "id" | "dateCreated" | "dateUpdated"> {
  // Normalize the data structure to handle different field names
  const normalizedData = {
    id: statsigData.id || statsigData.configName || statsigData.name,
    name: statsigData.name || statsigData.configName || statsigData.id,
    description: statsigData.description || "",
    value: statsigData.value !== undefined ? statsigData.value : statsigData.defaultValue,
    defaultValue: statsigData.defaultValue !== undefined ? statsigData.defaultValue : statsigData.value,
    rules: statsigData.rules || [],
    owner: statsigData.owner || statsigData.createdBy || statsigData.creator || {},
    environment: statsigData.environment || statsigData.env || "production",
    isActive: statsigData.isActive !== undefined ? statsigData.isActive : 
              statsigData.status === "active" ? true : 
              statsigData.status === "inactive" ? false : 
              statsigData.enabled !== undefined ? statsigData.enabled : true,
    tags: statsigData.tags || []
  };

  // Convert rules to GrowthBook feature rules
  const rules: FeatureRule[] = (normalizedData.rules || []).map((rule: any) => {
    const ruleId = rule.id || rule.ruleID || `rule_${Math.random().toString(36).substr(2, 9)}`;
    const ruleValue = rule.value !== undefined ? rule.value : rule.returnValue;
    const passPercentage = rule.passPercentage || rule.percentage || rule.coverage;
    
    // Determine rule type based on passPercentage
    if (passPercentage && passPercentage < 100) {
      // Rollout rule
      return {
        id: ruleId,
        type: "rollout",
        description: rule.description || "",
        condition: rule.condition || "{}",
        value: typeof ruleValue === "object" ? JSON.stringify(ruleValue) : ruleValue.toString(),
        coverage: passPercentage / 100,
        hashAttribute: rule.idType === "stableID" ? "id" : "anonymousId",
        enabled: true,
      };
    } else {
      // Force rule
      return {
        id: ruleId,
        type: "force",
        description: rule.description || "",
        condition: rule.condition || "{}",
        value: typeof ruleValue === "object" ? JSON.stringify(ruleValue) : ruleValue.toString(),
        enabled: true,
      };
    }
  });

  // Create environment settings
  const environmentSettings: Record<string, FeatureEnvironment> = {
    [normalizedData.environment]: {
      enabled: normalizedData.isActive,
      rules: rules,
    },
  };

  // Determine value type based on the structure of the value
  const getValueType = (value: any): "boolean" | "string" | "number" | "json" => {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "string") return "string";
    if (typeof value === "number") return "number";
    return "json";
  };

  const valueType = getValueType(normalizedData.defaultValue);

  // Get owner email from various possible field names
  const ownerEmail = normalizedData.owner.ownerEmail || 
                    normalizedData.owner.email || 
                    normalizedData.owner.userID || 
                    "unknown@example.com";

  const feature: Omit<FeatureInterface, "id" | "dateCreated" | "dateUpdated"> = {
    organization: organizationId,
    project: projectId,
    owner: ownerEmail,
    description: normalizedData.description,
    valueType,
    defaultValue: typeof normalizedData.defaultValue === "object" ? JSON.stringify(normalizedData.defaultValue) : normalizedData.defaultValue.toString(),
    version: 1,
    tags: normalizedData.tags,
    environmentSettings,
    archived: !normalizedData.isActive,
    linkedExperiments: [],
    jsonSchema: undefined,
    customFields: {},
    prerequisites: [],
    holdout: undefined,
  };

  return feature;
}

/**
 * Validates the input Statsig dynamic config data before conversion
 * @param data - The input data to validate
 * @returns Validation result with success/error information
 */
export function validateStatsigDynamicConfigData(data: any): { success: boolean; error?: string } {
  try {
    console.log("Validating Statsig dynamic config data:", JSON.stringify(data, null, 2));
    
    // Basic required fields validation - be more flexible with field names
    if (!data.id && !data.configName && !data.name) {
      return { success: false, error: "Missing required field: id, configName, or name" };
    }
    
    // Handle different possible field names for name
    const name = data.name || data.configName || data.id;
    if (!name) {
      return { success: false, error: "Missing required field: name/configName" };
    }
    
    // Handle different possible field names for value
    const value = data.value !== undefined ? data.value : data.defaultValue;
    if (!value || (typeof value !== "object" && typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) {
      return { success: false, error: "Missing or invalid value field. Found: " + typeof value };
    }
    
    // Handle different possible field names for defaultValue
    const defaultValue = data.defaultValue !== undefined ? data.defaultValue : data.value;
    if (!defaultValue || (typeof defaultValue !== "object" && typeof defaultValue !== "string" && typeof defaultValue !== "number" && typeof defaultValue !== "boolean")) {
      return { success: false, error: "Missing or invalid defaultValue field. Found: " + typeof defaultValue };
    }
    
    // Handle different possible owner structures
    const owner = data.owner || data.createdBy || data.creator;
    if (!owner || (!owner.ownerEmail && !owner.email && !owner.userID)) {
      return { success: false, error: "Missing required field: owner information (ownerEmail, email, or userID)" };
    }
    
    // Handle different possible environment field names
    const environment = data.environment || data.env || "production";
    if (!environment) {
      return { success: false, error: "Missing required field: environment" };
    }
    
    // Handle different possible active status field names
    const isActive = data.isActive !== undefined ? data.isActive : 
                    data.status === "active" ? true : 
                    data.status === "inactive" ? false : 
                    data.enabled !== undefined ? data.enabled : true;
    
    if (typeof isActive !== "boolean") {
      return { success: false, error: "Missing or invalid isActive/enabled field. Found: " + typeof isActive };
    }

    // Validate rules structure - be more flexible
    if (data.rules && Array.isArray(data.rules)) {
      for (const rule of data.rules) {
        if (!rule.id && !rule.ruleID) {
          return { success: false, error: "Each rule must have an id or ruleID" };
        }
        const ruleValue = rule.value !== undefined ? rule.value : rule.returnValue;
        if (!ruleValue || (typeof ruleValue !== "object" && typeof ruleValue !== "string" && typeof ruleValue !== "number" && typeof ruleValue !== "boolean")) {
          return { success: false, error: "Each rule must have a valid value. Found: " + typeof ruleValue };
        }
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Validation error: ${error.message}` };
  }
}

/**
 * Helper function to convert a complete Statsig dynamic config with validation
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Conversion result with success/error information and converted data
 */
export function convertStatsigDynamicConfig(
  statsigData: any,
  organizationId: string,
  projectId?: string
): { success: boolean; data?: Omit<FeatureInterface, "id" | "dateCreated" | "dateUpdated">; error?: string } {
  // Validate input data first
  const validation = validateStatsigDynamicConfigData(statsigData);
  if (!validation.success) {
    return { success: false, error: validation.error };
  }

  try {
    const convertedData = convertStatsigDynamicConfigToGrowthBook(statsigData, organizationId, projectId);
    return { success: true, data: convertedData };
  } catch (error) {
    return { success: false, error: `Conversion error: ${error.message}` };
  }
}
