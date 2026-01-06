import { SDKAttribute } from "shared/types/organization";

/**
 * Get the appropriate data type and format for an attribute based on its name and operators used
 */
function getAttributeDataTypeAndFormat(
  attributeName: string,
  operators: string[],
): { datatype: string; format: string } {
  // Check for version operators
  const hasVersionOperator = operators.some((op) =>
    ["version_gt", "version_lt", "version_gte", "version_lte"].includes(op),
  );
  if (hasVersionOperator) {
    return { datatype: "string", format: "version" };
  }

  // Check for date-like operators
  const hasDateOperator = operators.some((op) =>
    ["before", "after", "on"].includes(op),
  );
  if (hasDateOperator) {
    return { datatype: "string", format: "date" };
  }

  // Special cases based on attribute name
  if (attributeName === "time") {
    // Statsig time is Unix timestamp in milliseconds (number)
    return { datatype: "number", format: "" };
  }

  // Default to string
  return { datatype: "string", format: "" };
}

/**
 * Check if an attribute exists in the schema and create it if missing
 */
export async function ensureAttributeExists(
  attributeName: string,
  existingAttributeSchema: SDKAttribute[],
  apiCall: (
    path: string,
    options?: { method: string; body: string },
  ) => Promise<unknown>,
  operators: string[] = [],
): Promise<void> {
  // Check if attribute already exists
  const existingAttribute = existingAttributeSchema.find(
    (attr) => attr.property === attributeName && !attr.archived,
  );

  if (existingAttribute) {
    return; // Attribute already exists, no need to create
  }

  try {
    // Create the attribute with smart type and format detection
    const { datatype, format } = getAttributeDataTypeAndFormat(
      attributeName,
      operators,
    );
    await apiCall("/attribute", {
      method: "POST",
      body: JSON.stringify({
        property: attributeName,
        datatype: datatype,
        description: "",
        format: format,
        enum: "",
        projects: [], // Empty projects array
      }),
    });
  } catch (error) {
    // If it already exists, that's fine - just log and continue
    if (error.message?.includes("already exists") || error.status === 409) {
      console.log(
        `Attribute ${attributeName} already exists, skipping creation`,
      );
    } else {
      console.warn(
        `Failed to create attribute ${attributeName}:`,
        error.message,
      );
    }
  }
}
