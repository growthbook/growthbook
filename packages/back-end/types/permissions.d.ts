import { permissionsList, envLevelPermissions } from "shared";

export type Permission =
  | typeof permissionsList[number]
  | typeof envLevelPermissions[number]
  | `${typeof envLevelPermissions[number]}_${string}`;

export type EnvPermission = typeof envLevelPermissions[number];

export type Permissions = Permission[];
