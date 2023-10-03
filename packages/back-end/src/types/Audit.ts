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
] as const;

export type EntityType = typeof EntityType[number];
