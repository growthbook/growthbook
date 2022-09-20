import { Request } from "express";
import { OrganizationInterface } from "../../types/organization";
import { AuditInterface } from "../../types/audit";
import { Permissions } from "../../types/organization";
import { SSOConnectionInterface } from "../../types/sso-connection";

// eslint-disable-next-line
export type AuthRequest<Body = any, Params = any, Query = any> = Request<Params, null, Body, Query> & {
  email: string;
  verified?: boolean;
  userId?: string;
  loginMethod?: SSOConnectionInterface;
  name?: string;
  admin?: boolean;
  organization?: OrganizationInterface;
  permissions: Permissions;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
  checkPermissions: (...permission: (keyof Permissions)[]) => void;
};
