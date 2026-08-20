export function resolveFilterManagedBy(
  explicit: "" | "api" | undefined,
  factTableManagedBy: "" | "api" | "admin" | undefined,
): "" | "api" | undefined {
  if (explicit !== undefined) return explicit;
  // An api-managed Fact Table cannot have a UI-editable filter.
  if (factTableManagedBy === "api") return "api";
  return undefined;
}
