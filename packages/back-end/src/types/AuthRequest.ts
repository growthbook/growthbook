import { Request, Response } from "express";
import { UserScopedGrowthBook } from "@growthbook/growthbook";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { AuditInterface } from "shared/types/audit";
import {
  EnvScopedPermission,
  GlobalPermission,
  OrganizationInterface,
  ProjectScopedPermission,
} from "shared/types/organization";
import { TeamInterface } from "shared/types/team";
import { UserInterface } from "shared/types/user";
import { AppFeatures } from "back-end/types/app-features";

export type PermissionFunctions = {
  checkPermissions(permission: GlobalPermission): void;
  checkPermissions(
    permission: ProjectScopedPermission,
    project: string | string[] | undefined,
  ): void;
  checkPermissions(
    permission: EnvScopedPermission,
    project: string | (string | undefined)[] | undefined,
    envs: string[] | Set<string>,
  ): void;
};

export type AuthRequest<
  Body = unknown,
  Params = unknown,
  QueryParams = unknown,
> = Request<Params, unknown, Body, QueryParams> & {
  currentUser: Pick<
    UserInterface,
    "email" | "id" | "name" | "verified" | "superAdmin"
  >;
  email: string;
  verified?: boolean;
  userId?: string;
  loginMethod?: SSOConnectionInterface;
  authSubject?: string;
  name?: string;
  vercelInstallationId?: string;
  superAdmin?: boolean;
  organization?: OrganizationInterface;
  teams: TeamInterface[];
  audit: (
    data: Omit<AuditInterface, "organization" | "id" | "user" | "dateCreated">,
  ) => Promise<void>;
  gb?: UserScopedGrowthBook<AppFeatures>;
} & PermissionFunctions;

export type ResponseWithStatusAndError<T = unknown> = Response<
  | (T & { status: 200 })
  | {
      status: 400 | 401 | 403 | 404 | 405 | 406 | 429;
      message: string;
      retryAfter?: number;
    }
>;
