import { IssuerMetadata } from "openid-client";

export interface SSOConnectionInterface {
  id?: string;
  dateCreated?: Date;
  organization?: string;
  emailDomains?: string[];
  additionalScope?: string;
  idpType?:
    | "okta"
    | "azure"
    | "google"
    | "onelogin"
    | "jumpcloud"
    | "auth0"
    | "oidc";
  clientId: string;
  clientSecret?: string;
  extraQueryParams?: Record<string, string>;
  metadata: IssuerMetadata;
  tenantId?: string;
  baseURL?: string;
  audience?: string;
}

export type RedirectResponse = { redirectURI: string; confirm?: boolean };
export type ShowLoginResponse = { showLogin: true; newInstallation: boolean };
export type UnauthenticatedResponse = RedirectResponse | ShowLoginResponse;
export type IdTokenResponse = { token: string };
