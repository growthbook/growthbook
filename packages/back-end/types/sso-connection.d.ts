import { IssuerMetadata } from "openid-client";

export interface SSOConnectionInterface {
  id?: string;
  dateCreated?: Date;
  organization?: string;
  emailDomains?: string[];
  additionalScope?: string;
  idpType?: string;
  clientId: string;
  clientSecret?: string;
  extraQueryParams?: Record<string, string>;
  metadata: IssuerMetadata;
}

export type RedirectResponse = { redirectURI: string; confirm?: boolean };
export type ShowLoginResponse = { showLogin: true; newInstallation: boolean };
export type UnauthenticatedResponse = RedirectResponse | ShowLoginResponse;
export type IdTokenResponse = { token: string };
