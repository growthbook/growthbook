import type { Request, Response } from "express";
import type { UserScopedGrowthBook } from "@growthbook/growthbook";
import type { SSOConnectionInterface } from "shared/types/sso-connection";
import type { AuditInterface } from "shared/types/audit";
import type {
  EnvScopedPermission,
  GlobalPermission,
  OrganizationInterface,
  ProjectScopedPermission,
} from "shared/types/organization";
import type { TeamInterface } from "shared/types/team";
import type { UserInterface } from "shared/types/user";
import type { SuperAdmin } from "shared/validators";
import type { AppFeatures } from "shared/types/app-features";

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
    | "email"
    | "id"
    | "name"
    | "verified"
    | "superAdmin"
    | "npsSurveyAt"
    | "dateCreated"
  >;
  email: string;
  verified?: boolean;
  userId?: string;
  loginMethod?: SSOConnectionInterface;
  authSubject?: string;
  name?: string;
  vercelInstallationId?: string;
  superAdmin?: SuperAdmin;
  organization?: OrganizationInterface;
  teams: TeamInterface[];
  // Ids of restrictAccess projects, loaded with the org for permission resolution
  restrictedProjects?: string[];
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
