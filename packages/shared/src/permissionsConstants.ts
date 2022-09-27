export const permissionsList = [
  "addComments",
  "createPresentations",
  "createIdeas",
  "createFeatures",
  "createFeatureDrafts",
  "createAnalyses",
  "createMetrics",
  "createDimensions",
  "createSegments",
  "createDatasources",
  "editDatasourceSettings",
  "organizationSettings",
  "publishFeatures",
  "runQueries",
  "superDelete",
] as const;

export const envLevelPermissions = ["publishFeatures"] as const;

type Permission =
  | typeof permissionsList[number]
  | typeof envLevelPermissions[number]
  | `${typeof envLevelPermissions[number]}_${string}`;

export const defaultPermissions: Record<Permission, boolean> = {
  addComments: false,
  createPresentations: false,
  createIdeas: false,
  createFeatures: false,
  createFeatureDrafts: false,
  createAnalyses: false,
  createMetrics: false,
  createDimensions: false,
  createSegments: false,
  createDatasources: false,
  editDatasourceSettings: false,
  organizationSettings: false,
  publishFeatures: false,
  runQueries: false,
  superDelete: false,
};
