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
  const stringLikeTypes: CustomFieldTypes[] = ["text", "textarea", "markdown", "url"];
  const safeConversions: Record<CustomFieldTypes, CustomFieldTypes[]> = {
    enum: [...stringLikeTypes, "multiselect"],
    multiselect: ["text", "textarea", "markdown"],
    boolean: [...stringLikeTypes, "number"],
    number: stringLikeTypes,
    date: [...stringLikeTypes, "datetime"],
    datetime: [...stringLikeTypes, "date"],
    text: stringLikeTypes.filter(t => t !== "text"),
    textarea: stringLikeTypes.filter(t => t !== "textarea"),
    markdown: stringLikeTypes.filter(t => t !== "markdown"),
    url: stringLikeTypes.filter(t => t !== "url"),
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

  // Enum/multiselect option changes - only warn if options were removed
  if (
    (fromType === "enum" || fromType === "multiselect") &&
    fromValues !== toValues &&
    fromValues &&
    toValues
  ) {
    const oldOptions = fromValues.split(",").map((v) => v.trim());
    const newOptions = toValues.split(",").map((v) => v.trim());
    const removedOptions = oldOptions.filter((opt) => !newOptions.includes(opt));
    
    if (removedOptions.length > 0) {
      return `Removing options may result in data loss. Existing values that are no longer in the options list will be removed.`;
    }
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