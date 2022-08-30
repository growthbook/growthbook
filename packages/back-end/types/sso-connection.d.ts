export interface IssuerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  end_session_endpoint: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported: string[];
}

export interface SSOConnectionInterface {
  id?: string;
  dateCreated?: Date;
  organization?: string;
  emailDomain?: string;
  idpType?: string;
  clientId: string;
  extraQueryParams?: Record<string, string>;
  metadata: IssuerMetadata;
}

export interface SSOConnectionParams {
  id: string;
  clientId: string;
  extraQueryParams?: Record<string, string>;
  metadata: IssuerMetadata;
}
