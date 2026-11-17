// Datasource types with no exposure/health query support.
export const datasourcesWithoutHealthData = new Set([
  "mixpanel",
  "google_analytics",
]);

export function hasHealthData(
  datasource: { type: string } | null | undefined,
): boolean {
  return !!datasource && !datasourcesWithoutHealthData.has(datasource.type);
}
