import { Request } from "express";
import {
  EnvScopedPermission,
  GlobalPermission,
  OrganizationInterface,
  Permission,
} from "../../types/organization";
import { AuditInterface } from "../../types/audit";
import { SSOConnectionInterface } from "../../types/sso-connection";

interface PermissionFunctions {
  checkPermissions(permission: GlobalPermission): void;
  checkPermissions(permissions: EnvScopedPermission, envs: string[]): void;
}

// eslint-disable-next-line
export type AuthRequest<
  Body = unknown,
  Params = unknown,
  QueryParams = unknown
> = Request<Params, unknown, Body, QueryParams> & {
  email: string;
  verified?: boolean;
  userId?: string;
  loginMethod?: SSOConnectionInterface;
  authSubject?: string;
  name?: string;
  admin?: boolean;
  organization?: OrganizationInterface;
  permissions: Set<Permission>;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
} & PermissionFunctions;
