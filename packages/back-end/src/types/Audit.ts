export const EntityType = [
  "experiment",
  "feature",
  "metric",
  "datasource",
  "comment",
  "user",
  "organization",
  "project",
  "savedGroup",
  "archetype",
  "team",
] as const;

export type EntityType = typeof EntityType[number];
