export const EntityType = [
  "experiment",
  "feature",
  "metric",
  "datasource",
  "comment",
  "user",
  "organization",
  "savedGroup",
  "savedSearch",
  "team",
] as const;

export type EntityType = typeof EntityType[number];
