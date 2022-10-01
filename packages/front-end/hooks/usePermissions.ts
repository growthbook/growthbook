import { EnvPermissions, Permission } from "back-end/types/permissions";
import useUser from "./useUser";

type PermissionDescriptors = {
  title?: string;
  displayName: string;
  description: string;
};

export const PERMISSIONS: Record<Permission, PermissionDescriptors> = {
  addComments: {
    title: "Safe Permissions (does not affect data)",
    displayName: "Add Comments",
    description: "Allows users to add comments to features",
  },
  createPresentations: {
    displayName: "Create Presentations",
    description: "Allows users to create presentations",
  },
  createIdeas: {
    displayName: "Create Ideas",
    description: "Allows users to create ideas",
  },
  createFeatures: {
    title: "Feature Permissions",
    displayName: "Create Features",
    description: "Allows users to create features",
  },
  createFeatureDrafts: {
    displayName: "Create Feature Drafts",
    description: "Allows users to create feature drafts",
  },
  publishFeatures: {
    displayName: "Publish Features",
    description: "Allows users to publish features",
  },
  createAnalyses: {
    title: "Analysis Permissions",
    displayName: "Create Analyses",
    description: "Allows users to create analyses",
  },
  createMetrics: {
    displayName: "Create Metrics",
    description: "Allows users to create metrics",
  },
  createDimensions: {
    displayName: "Create Dimensions",
    description: "Allows users to create dimensions",
  },
  createSegments: {
    displayName: "Create Segments",
    description: "Allows users to create segments",
  },
  editDatasourceSettings: {
    displayName: "Edit Datasource Settings",
    description: "Allows users to edit datasource settings",
  },
  runQueries: {
    displayName: "Run Queries",
    description: "Allows users to run queries",
  },
  organizationSettings: {
    title: "Admin Permissions",
    displayName: "Organization Settings",
    description: "Allows users to edit organization settings",
  },
  superDelete: {
    displayName: "Super Delete",
    description: "Allows users to delete anything",
  },
  createDatasources: {
    displayName: "Create Datasources",
    description: "Allows users to create datasources",
  },
};

export const DEFAULT_PERMISSIONS: Record<Permission, boolean> = Object.keys(
  PERMISSIONS
).reduce((permission, key) => {
  permission[key] = false;
  return permission;
}, {} as Record<Permission, boolean>);

export const ENV_PERMISSIONS: EnvPermissions[] = ["publishFeatures"];

export const isEnvPermission = (p: string) => p.includes("_");
export const getEnvPermissionBase = (p: string) => p.split("_")[0];
export const getEnvFromPermission = (p: string) => p.split("_")[1];

type UsePermissionsReturn = Record<Permission, boolean> &
  Record<"canPublishFeatures", (...evns: string[]) => boolean>;

export default function usePermissions(): UsePermissionsReturn {
  const permissions = new Set(useUser().permissions);

  return {
    addComments: permissions.has("addComments"),
    createPresentations: permissions.has("createPresentations"),
    createIdeas: permissions.has("createIdeas"),
    createFeatures: permissions.has("createFeatures"),
    createFeatureDrafts: permissions.has("createFeatureDrafts"),
    publishFeatures: permissions.has("publishFeatures"),
    createAnalyses: permissions.has("createAnalyses"),
    createMetrics: permissions.has("createMetrics"),
    createDimensions: permissions.has("createDimensions"),
    createSegments: permissions.has("createSegments"),
    createDatasources: permissions.has("createDatasources"),
    editDatasourceSettings: permissions.has("editDatasourceSettings"),
    organizationSettings: permissions.has("organizationSettings"),
    runQueries: permissions.has("runQueries"),
    superDelete: permissions.has("superDelete"),
    canPublishFeatures(...envs: string[]) {
      if (permissions.has("publishFeatures")) return true;
      for (const env of envs)
        if (permissions.has(`publishFeatures_${env}`)) return true;
      return false;
    },
  };
}
