import { IssuerMetadata } from "openid-client";

export interface SSOConnectionInterface {
  id?: string;
  dateCreated?: Date;
  organization?: string;
  emailDomain?: string;
  idpType?: string;
  authority?: string;
  clientId: string;
  extraQueryParams?: Record<string, string>;
  metadata?: IssuerMetadata;
}

export interface SSOConnectionParams {
  id: string;
  authority?: string;
  clientId: string;
  extraQueryParams?: Record<string, string>;
  metadata?: IssuerMetadata;
}
