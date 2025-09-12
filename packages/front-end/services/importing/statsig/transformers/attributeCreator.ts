import { SDKAttribute } from "back-end/types/organization";

/**
 * Get the appropriate data type for an attribute based on its name
 */
function getAttributeDataType(attributeName: string): string {
  // Special cases, otherwise use string
  if (attributeName === "time") {
    return "number";
  }
  return "string";
}

/**
 * Check if an attribute exists in the schema and create it if missing
 */
export async function ensureAttributeExists(
  attributeName: string,
  existingAttributeSchema: SDKAttribute[],
  apiCall: (path: string, options?: any) => Promise<any>,
): Promise<void> {
  // Check if attribute already exists
  const existingAttribute = existingAttributeSchema.find(
    (attr) => attr.property === attributeName && !attr.archived,
  );

  if (existingAttribute) {
    return; // Attribute already exists, no need to create
  }

  try {
    // Create the attribute
    const datatype = getAttributeDataType(attributeName);
    await apiCall("/attribute", {
      method: "POST",
      body: JSON.stringify({
        property: attributeName,
        datatype: datatype,
        description: "",
        format: "",
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
