type BasePermissions =
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

export type EnvPermissions = "publishFeatures";

export type Permission =
  | BasePermissions
  | EnvPermissions
  | `${EnvPermissions}_${string}`;

export type Permissions = Permission[];
