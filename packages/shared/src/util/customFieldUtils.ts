import { CustomFieldTypes } from "shared/types/custom-fields";

/**
 * Determines if a custom field type change is safe (no data loss) or destructive
 */
export function isCustomFieldTypeChangeSafe(
  fromType: CustomFieldTypes,
  toType: CustomFieldTypes,
  fromValues?: string,
  toValues?: string,
): boolean {
  // No change
  if (fromType === toType) {
    // For enum/multiselect, check if options changed
    if (fromType === "enum" || fromType === "multiselect") {
      return fromValues === toValues;
    }
    return true;
  }

  // Safe conversions (automatic, no data loss)
  const safeConversions: Record<CustomFieldTypes, CustomFieldTypes[]> = {
    enum: ["text", "textarea", "markdown", "url"],
    multiselect: ["text", "textarea", "markdown"],
    boolean: ["text", "textarea", "markdown"],
    number: ["text", "textarea", "markdown", "url"],
    date: ["text", "textarea", "markdown", "datetime"],
    datetime: ["text", "textarea", "markdown", "date"],
    text: ["textarea", "markdown", "url"],
    textarea: ["text", "markdown"],
    markdown: ["text", "textarea"],
    url: ["text", "textarea", "markdown"],
  };

  return safeConversions[fromType]?.includes(toType) ?? false;
}

/**
 * Get a user-friendly warning message for destructive custom field changes
 */
export function getCustomFieldChangeWarning(
  fromType: CustomFieldTypes,
  toType: CustomFieldTypes,
  fromValues?: string,
  toValues?: string,
): string | null {
  if (isCustomFieldTypeChangeSafe(fromType, toType, fromValues, toValues)) {
    return null;
  }

  // Type change warnings
  if (fromType !== toType) {
    return `Changing from "${fromType}" to "${toType}" may result in data loss. Existing values that cannot be converted will be removed.`;
  }

  // Enum/multiselect option changes
  if (
    (fromType === "enum" || fromType === "multiselect") &&
    fromValues !== toValues
  ) {
    return `Changing the available options may result in data loss. Existing values that are no longer in the options list will be removed.`;
  }

  return null;
}

/**
 * Get warning for project scope restrictions
 */
export function getCustomFieldProjectChangeWarning(
  fromProjects: string[] | undefined,
  toProjects: string[] | undefined,
): string | null {
  const fromEmpty = !fromProjects || fromProjects.length === 0;
  const toEmpty = !toProjects || toProjects.length === 0;

  // Restricting from all projects to specific projects
  if (fromEmpty && !toEmpty) {
    return "Restricting to specific projects may make existing values in other projects inaccessible.";
  }

  // Removing projects from the list
  if (!fromEmpty && !toEmpty) {
    const removedProjects = fromProjects.filter((p) => !toProjects.includes(p));
    if (removedProjects.length > 0) {
      return "Removing projects may make existing values inaccessible.";
    }
  }

  return null;
}
