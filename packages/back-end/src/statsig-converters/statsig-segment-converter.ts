import { z } from "zod";
import { SegmentInterface } from "back-end/types/segment";

// Statsig Segment data structure
export interface StatsigSegmentData {
  id: string;
  name: string;
  description?: string;
  type: "segment";
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
  // Segment-specific fields
  condition?: string;
  sql?: string;
  // User ID type for the segment
  userIdType?: "user_id" | "anonymous_id" | "stable_id";
  // Data source information
  datasource?: string;
  // Projects this segment belongs to
  projects?: string[];
}

/**
 * Converts Statsig segment data to GrowthBook segment format
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param datasourceId - The GrowthBook datasource ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Partial SegmentInterface ready for creation
 */
export function convertStatsigSegmentToGrowthBook(
  statsigData: StatsigSegmentData,
  organizationId: string,
  datasourceId: string,
  projectId?: string
): Omit<SegmentInterface, "id" | "dateCreated" | "dateUpdated"> {
  // Determine segment type based on available data
  let segmentType: "SQL" | "FACT" = "SQL";
  let sql = statsigData.sql || "";
  let factTableId: string | undefined;
  let filters: string[] | undefined;

  // If we have a condition but no SQL, try to convert condition to SQL
  if (statsigData.condition && !sql) {
    // This is a simplified conversion - in practice, you'd need more sophisticated
    // logic to convert Statsig conditions to SQL
    sql = `SELECT DISTINCT user_id FROM events WHERE ${statsigData.condition}`;
  }

  // If no SQL is available, create a basic segment
  if (!sql) {
    sql = `SELECT DISTINCT user_id FROM events WHERE 1=1`;
  }

  // Map user ID type
  const userIdType = statsigData.userIdType || "user_id";

  const segment: Omit<SegmentInterface, "id" | "dateCreated" | "dateUpdated"> = {
    organization: organizationId,
    datasource: datasourceId,
    name: statsigData.name,
    description: statsigData.description || "",
    owner: statsigData.owner.ownerEmail,
    userIdType,
    type: segmentType,
    managedBy: "",
    sql,
    factTableId,
    filters,
    projects: projectId ? [projectId] : statsigData.projects || [],
  };

  return segment;
}

/**
 * Validates the input Statsig segment data before conversion
 * @param data - The input data to validate
 * @returns Validation result with success/error information
 */
export function validateStatsigSegmentData(data: any): { success: boolean; error?: string } {
  try {
    console.log("Validating Statsig segment data:", JSON.stringify(data, null, 2));
    
    // Basic required fields validation - be more flexible with field names
    if (!data.id && !data.segmentName && !data.name) {
      return { success: false, error: "Missing required field: id, segmentName, or name" };
    }
    
    // Handle different possible field names for name
    const name = data.name || data.segmentName || data.id;
    if (!name) {
      return { success: false, error: "Missing required field: name/segmentName" };
    }
    
    // Handle different possible owner structures
    const owner = data.owner || data.createdBy || data.creator;
    if (!owner || (!owner.ownerEmail && !owner.email && !owner.userID)) {
      return { success: false, error: "Missing required field: owner information (ownerEmail, email, or userID)" };
    }

    // Validate that we have either SQL or condition - be more flexible
    const sql = data.sql || data.query || data.sqlQuery;
    const condition = data.condition || data.conditions || data.rule;
    if (!sql && !condition) {
      return { success: false, error: "Segment must have either SQL query or condition. Found sql: " + !!sql + ", condition: " + !!condition };
    }

    // Validate user ID type if provided - be more flexible
    const userIdType = data.userIdType || data.user_id_type || data.idType || data.id_type;
    if (userIdType && !["user_id", "anonymous_id", "stable_id", "userID", "anonymousID", "stableID"].includes(userIdType)) {
      return { success: false, error: "Invalid userIdType. Must be one of: user_id, anonymous_id, stable_id. Found: " + userIdType };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: `Validation error: ${error.message}` };
  }
}

/**
 * Helper function to convert a complete Statsig segment with validation
 * @param statsigData - The input data from Statsig
 * @param organizationId - The GrowthBook organization ID
 * @param datasourceId - The GrowthBook datasource ID
 * @param projectId - The GrowthBook project ID (optional)
 * @returns Conversion result with success/error information and converted data
 */
export function convertStatsigSegment(
  statsigData: any,
  organizationId: string,
  datasourceId: string,
  projectId?: string
): { success: boolean; data?: Omit<SegmentInterface, "id" | "dateCreated" | "dateUpdated">; error?: string } {
  // Validate input data first
  const validation = validateStatsigSegmentData(statsigData);
  if (!validation.success) {
    return { success: false, error: validation.error };
  }

  try {
    const convertedData = convertStatsigSegmentToGrowthBook(statsigData, organizationId, datasourceId, projectId);
    return { success: true, data: convertedData };
  } catch (error) {
    return { success: false, error: `Conversion error: ${error.message}` };
  }
}
