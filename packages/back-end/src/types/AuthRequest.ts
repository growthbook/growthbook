import { Request } from "express";
import { OrganizationDocument } from "../models/OrganizationModel";
import { AuditInterface } from "../../types/audit";
import { Permissions } from "../../types/organization";

// eslint-disable-next-line
export type AuthRequest<T = any> = Request<null, null, T> & {
  email: string;
  userId?: string;
  name?: string;
  admin?: boolean;
  organization?: OrganizationDocument;
  permissions: Permissions;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
};
