import { z } from "zod";
import { FeatureInterface, FeatureRule, FeatureEnvironment } from "./features";

// Statsig Layer data structure
export interface StatsigLayerData {
  id: string;
  name: string;
  description?: string;
  type: "layer";
  configType: "layer";
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
  // Layer-specific fields
  parameterConfigs?: Array<{
    name: string;
    type: string;
    defaultValue: any;
    description?: string;
  }>;
}

/**
 * Converts Statsig layer data to GrowthBook feature format
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Partial FeatureInterface ready for creation
 */
export function convertStatsigLayerToGrowthBook(
  statsigData: StatsigLayerData,
  organizationId: string,
  projectId?: string
): Omit<FeatureInterface, "id" | "dateCreated" | "dateUpdated"> {
  // Convert rules to GrowthBook feature rules
  const rules: FeatureRule[] = statsigData.rules.map((rule) => {
    // Determine rule type based on passPercentage
    if (rule.passPercentage && rule.passPercentage < 100) {
      // Rollout rule
      return {
        id: rule.id,
        type: "rollout",
        description: rule.description || "",
        condition: rule.condition || "{}",
        value: JSON.stringify(rule.value),
        coverage: rule.passPercentage / 100,
        hashAttribute: rule.idType === "stableID" ? "id" : "anonymousId",
        enabled: true,
      };
    } else {
      // Force rule
      return {
        id: rule.id,
        type: "force",
        description: rule.description || "",
        condition: rule.condition || "{}",
        value: JSON.stringify(rule.value),
        enabled: true,
      };
    }
  });

  // Create environment settings
  const environmentSettings: Record<string, FeatureEnvironment> = {
    [statsigData.environment]: {
      enabled: statsigData.isActive,
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

  const valueType = getValueType(statsigData.defaultValue);

  // Create JSON schema for layer parameters if they exist
  let jsonSchema;
  if (statsigData.parameterConfigs && statsigData.parameterConfigs.length > 0) {
    const schemaFields = statsigData.parameterConfigs.map((param) => ({
      key: param.name,
      type: (param.type === "string" ? "string" : 
            param.type === "number" ? "integer" : 
            param.type === "boolean" ? "boolean" : "string") as "string" | "boolean" | "integer" | "float",
      required: true,
      default: param.defaultValue?.toString() || "",
      description: param.description || "",
      enum: [] as string[],
      min: param.type === "number" ? 0 : 0,
      max: param.type === "number" ? 1000 : 1000,
    }));

    jsonSchema = {
      schemaType: "simple" as const,
      schema: JSON.stringify({
        type: "object",
        properties: statsigData.parameterConfigs.reduce((acc, param) => {
          acc[param.name] = {
            type: param.type === "string" ? "string" : 
                  param.type === "number" ? "number" : 
                  param.type === "boolean" ? "boolean" : "string",
            description: param.description,
          };
          return acc;
        }, {} as Record<string, any>),
      }),
      simple: {
        type: "object" as const,
        fields: schemaFields,
      },
      date: new Date(),
      enabled: true,
    };
  }

  const feature: Omit<FeatureInterface, "id" | "dateCreated" | "dateUpdated"> = {
    organization: organizationId,
    project: projectId,
    owner: statsigData.owner.ownerEmail,
    description: statsigData.description || "",
    valueType,
    defaultValue: JSON.stringify(statsigData.defaultValue),
    version: 1,
    tags: statsigData.tags || [],
    environmentSettings,
    archived: !statsigData.isActive,
    linkedExperiments: [],
    jsonSchema,
    customFields: {},
    prerequisites: [],
    holdout: undefined,
  };

  return feature;
}

/**
 * Validates the input Statsig layer data before conversion
 * @param data - The input data to validate
 * @returns Validation result with success/error information
 */
export function validateStatsigLayerData(data: any): { success: boolean; error?: string } {
  try {
    // Basic required fields validation
    if (!data.id) {
      return { success: false, error: "Missing required field: id" };
    }
    if (!data.name) {
      return { success: false, error: "Missing required field: name" };
    }
    if (!data.value || typeof data.value !== "object") {
      return { success: false, error: "Missing or invalid value field" };
    }
    if (!data.defaultValue || typeof data.defaultValue !== "object") {
      return { success: false, error: "Missing or invalid defaultValue field" };
    }
    if (!data.owner || !data.owner.ownerEmail) {
      return { success: false, error: "Missing required field: owner.ownerEmail" };
    }
    if (!data.environment) {
      return { success: false, error: "Missing required field: environment" };
    }
    if (typeof data.isActive !== "boolean") {
      return { success: false, error: "Missing or invalid isActive field" };
    }

    // Validate rules structure
    if (data.rules && Array.isArray(data.rules)) {
      for (const rule of data.rules) {
        if (!rule.id) {
          return { success: false, error: "Each rule must have an id" };
        }
        if (!rule.value || typeof rule.value !== "object") {
          return { success: false, error: "Each rule must have a valid value object" };
        }
      }
    }

    // Validate parameter configs if they exist
    if (data.parameterConfigs && Array.isArray(data.parameterConfigs)) {
      for (const param of data.parameterConfigs) {
        if (!param.name) {
          return { success: false, error: "Each parameter config must have a name" };
        }
        if (!param.type) {
          return { success: false, error: "Each parameter config must have a type" };
        }
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Validation error: ${error.message}` };
  }
}

/**
 * Helper function to convert a complete Statsig layer with validation
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Conversion result with success/error information and converted data
 */
export function convertStatsigLayer(
  statsigData: any,
  organizationId: string,
  projectId?: string
): { success: boolean; data?: Omit<FeatureInterface, "id" | "dateCreated" | "dateUpdated">; error?: string } {
  // Validate input data first
  const validation = validateStatsigLayerData(statsigData);
  if (!validation.success) {
    return { success: false, error: validation.error };
  }

  try {
    const convertedData = convertStatsigLayerToGrowthBook(statsigData, organizationId, projectId);
    return { success: true, data: convertedData };
  } catch (error) {
    return { success: false, error: `Conversion error: ${error.message}` };
  }
}
