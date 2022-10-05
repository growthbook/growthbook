import { Request } from "express";
import { OrganizationInterface, Permissions } from "../../types/organization";
import { AuditInterface } from "../../types/audit";
import { SSOConnectionInterface } from "../../types/sso-connection";

// eslint-disable-next-line
export type AuthRequest<B = any, P = any, Q = any> = Request<P, null, B, Q> & {
  email: string;
  verified?: boolean;
  userId?: string;
  loginMethod?: SSOConnectionInterface;
  authSubject?: string;
  name?: string;
  admin?: boolean;
  organization?: OrganizationInterface;
  permissions: Permissions;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
  checkPermissions: (...permission: (keyof Permissions)[]) => void;
};
