import { Request } from "express";
import { OrganizationInterface } from "../../types/organization";
import { AuditInterface } from "../../types/audit";
import { Permissions } from "../../types/organization";

// eslint-disable-next-line
export type AuthRequest<T = any> = Request<null, null, T> & {
  email: string;
  userId?: string;
  name?: string;
  admin?: boolean;
  isVerified?: boolean;
  organization?: OrganizationInterface;
  permissions: Permissions;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
};
