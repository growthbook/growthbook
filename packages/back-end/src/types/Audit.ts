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
  "urlRedirect",
] as const;

export type EntityType = typeof EntityType[number];
