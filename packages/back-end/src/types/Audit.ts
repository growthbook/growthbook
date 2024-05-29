export const EntityType = [
  "experiment",
  "feature",
  "metric",
  "datasource",
  "comment",
  "user",
  "organization",
  "savedGroup",
  "archetype",
  "team",
  "environment",
] as const;

export type EntityType = typeof EntityType[number];
