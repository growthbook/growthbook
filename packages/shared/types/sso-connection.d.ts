import { IssuerMetadata } from "openid-client";

export interface SSOConnectionInterface {
  id?: string;
  dateCreated?: Date;
  organization?: string;
  // Disabled connections cannot be used to log in (kept in sync with the
  // organization's disabled state by the admin enable/disable endpoints)
  disabled?: boolean;
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
export type IdTokenResponse = { token: string; ssoConnectionId?: string };
