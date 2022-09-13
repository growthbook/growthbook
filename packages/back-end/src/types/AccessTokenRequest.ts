import { Request } from "express";
import { OrganizationInterface } from "../../types/organization";
import { AuditInterface } from "../../types/audit";

// eslint-disable-next-line
export type AccessTokenRequest<B = any, P = any, Q = any> = Request<P, null, B, Q> & {
  organization: OrganizationInterface;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
};
