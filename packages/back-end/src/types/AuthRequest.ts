import { Request, Response } from "express";
import {
  EnvScopedPermission,
  GlobalPermission,
  OrganizationInterface,
  ProjectScopedPermission,
} from "@back-end/types/organization";
import { AuditInterface } from "@back-end/types/audit";
import { SSOConnectionInterface } from "@back-end/types/sso-connection";
import { TeamInterface } from "@back-end/types/team";

export type PermissionFunctions = {
  checkPermissions(permission: GlobalPermission): void;
  checkPermissions(
    permission: ProjectScopedPermission,
    project: string | string[] | undefined
  ): void;
  checkPermissions(
    permission: EnvScopedPermission,
    project: string | (string | undefined)[] | undefined,
    envs: string[] | Set<string>
  ): void;
};

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
  superAdmin?: boolean;
  organization?: OrganizationInterface;
  teams: TeamInterface[];
  audit: (
    data: Omit<AuditInterface, "organization" | "id" | "user" | "dateCreated">
  ) => Promise<void>;
} & PermissionFunctions;

export type ResponseWithStatusAndError<T = unknown> = Response<
  | (T & { status: 200 })
  | { status: 400 | 401 | 403 | 404 | 405 | 406; message: string }
>;
