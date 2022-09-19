import { Request } from "express";
import { OrganizationInterface } from "../../types/organization";
import { AuditInterface } from "../../types/audit";
import { Permissions } from "../../types/organization";
import { SSOConnectionInterface } from "../../types/sso-connection";

// eslint-disable-next-line
export type AuthRequest<B = any, P = any, Q = any> = Request<P, null, B, Q> & {
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
