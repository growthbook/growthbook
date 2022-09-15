import { Request } from "express";
import { OrganizationInterface } from "../../types/organization";
import { AuditInterface } from "../../types/audit";

// eslint-disable-next-line
export type AccessTokenRequest<Body = any, Params = any, Query = any> = Request<Params, null, Body, Query> & {
  organization: OrganizationInterface;
  audit: (data: Partial<AuditInterface>) => Promise<void>;
};
