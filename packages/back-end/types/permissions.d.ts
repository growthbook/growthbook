type BasePermission =
  | "addComments"
  | "createPresentations"
  | "createIdeas"
  | "createFeatures"
  | "createFeatureDrafts"
  | "createAnalyses"
  | "createMetrics"
  | "createDimensions"
  | "createSegments"
  | "createDatasources"
  | "editDatasourceSettings"
  | "organizationSettings"
  | "runQueries"
  | "superDelete";

export type EnvPermission = "publishFeatures";

export type Permission =
  | BasePermission
  | EnvPermission
  | `${EnvPermission}_${string}`;

export type Permissions = Permission[];
