import { SSOConnectionInterface } from "shared/types/sso-connection";

export const SSO_IDP_TYPES = [
  "okta",
  "azure",
  "google",
  "onelogin",
  "jumpcloud",
  "auth0",
  "oidc",
] as const;

export type SSOIdpType = (typeof SSO_IDP_TYPES)[number];

export const SSO_IDP_TYPE_OPTIONS: { label: string; value: SSOIdpType }[] = [
  { label: "Okta", value: "okta" },
  { label: "Azure/Entra", value: "azure" },
  { label: "Google", value: "google" },
  { label: "OneLogin", value: "onelogin" },
  { label: "JumpCloud", value: "jumpcloud" },
  { label: "Auth0", value: "auth0" },
  { label: "Other OIDC", value: "oidc" },
];

// Fills in additionalScope, extraQueryParams, and metadata for known identity
// provider types. For the generic "oidc" type, the passed-in values are kept as-is.
export function generateSSOConnection(
  data: SSOConnectionInterface,
): SSOConnectionInterface {
  const res: SSOConnectionInterface = {
    ...data,
  };

  if (data.idpType === "okta") {
    if (data.baseURL) {
      // Remove trailing slash
      const baseURL = data.baseURL.replace(/\/+$/, "");

      res.additionalScope = "offline_access";
      res.extraQueryParams = undefined;
      res.metadata = {
        issuer: `${baseURL}`,
        authorization_endpoint: `${baseURL}/oauth2/v1/authorize`,
        id_token_signing_alg_values_supported: ["RS256"],
        jwks_uri: `${baseURL}/oauth2/v1/keys`,
        token_endpoint: `${baseURL}/oauth2/v1/token`,
        code_challenge_methods_supported: ["S256"],
      };
    }
  } else if (data.idpType === "google") {
    res.extraQueryParams = {
      access_type: "offline",
      prompt: "consent",
    };
    res.additionalScope = "";
    res.metadata = {
      issuer: "https://accounts.google.com",
      authorization_endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
      token_endpoint: "https://oauth2.googleapis.com/token",
      jwks_uri: "https://www.googleapis.com/oauth2/v3/certs",
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
    };
  } else if (data.idpType === "auth0") {
    if (data.tenantId) {
      res.additionalScope = "offline_access";
      res.extraQueryParams = undefined;
      res.metadata = {
        issuer: `https://${data.tenantId}.auth0.com/`,
        authorization_endpoint: `https://${data.tenantId}.auth0.com/authorize`,
        logout_endpoint: `https://${data.tenantId}.auth0.com/v2/logout?client_id=${data.clientId}`,
        id_token_signing_alg_values_supported: ["HS256", "RS256"],
        jwks_uri: `https://${data.tenantId}.auth0.com/.well-known/jwks.json`,
        token_endpoint: `https://${data.tenantId}.auth0.com/oauth/token`,
        code_challenge_methods_supported: ["S256", "plain"],
        audience: data.audience || "",
      };
    }
  } else if (data.idpType === "azure") {
    if (data.tenantId) {
      res.additionalScope = "offline_access";
      res.extraQueryParams = undefined;
      res.metadata = {
        token_endpoint: `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/token`,
        jwks_uri: `https://login.microsoftonline.com/${data.tenantId}/discovery/v2.0/keys`,
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
        issuer: `https://login.microsoftonline.com/${data.tenantId}/v2.0`,
        authorization_endpoint: `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/authorize`,
        logout_endpoint: `https://login.microsoftonline.com/${data.tenantId}/oauth2/v2.0/logout`,
      };
    }
  } else if (data.idpType === "onelogin") {
    if (data.baseURL) {
      // Remove trailing slash
      const baseURL = data.baseURL.replace(/\/+$/, "");
      res.additionalScope = "";
      res.extraQueryParams = undefined;
      res.metadata = {
        issuer: `${baseURL}/oidc/2`,
        authorization_endpoint: `${baseURL}/oidc/2/auth`,
        token_endpoint: `${baseURL}/oidc/2/token`,
        id_token_signing_alg_values_supported: ["RS256", "HS256", "PS256"],
        jwks_uri: `${baseURL}/oidc/2/certs`,
        code_challenge_methods_supported: ["S256"],
        logout_endpoint: `${baseURL}/oidc/2/logout`,
      };
    }
  } else if (data.idpType === "jumpcloud") {
    res.additionalScope = "offline_access";
    res.extraQueryParams = undefined;
    res.metadata = {
      token_endpoint: "https://oauth.id.jumpcloud.com/oauth2/token",
      jwks_uri: "https://oauth.id.jumpcloud.com/.well-known/jwks.json",
      id_token_signing_alg_values_supported: ["RS256"],
      code_challenge_methods_supported: ["S256"],
      issuer: "https://oauth.id.jumpcloud.com/",
      authorization_endpoint: "https://oauth.id.jumpcloud.com/oauth2/auth",
      logout_endpoint: "https://oauth.id.jumpcloud.com/oauth2/sessions/logout",
      audience: "",
    };
  }

  return res;
}

// Which extra form fields each identity provider type requires when
// configuring a connection
export function ssoProviderRequiresBaseURL(idpType?: string): boolean {
  return idpType === "okta" || idpType === "onelogin";
}
export function ssoProviderRequiresTenantId(idpType?: string): boolean {
  return idpType === "azure" || idpType === "auth0";
}

// Deep link to the provider-specific section of the SSO setup docs
export function getSSOProviderDocsUrl(idpType?: string): string {
  const anchors: Record<string, string> = {
    okta: "#okta",
    google: "#google",
    auth0: "#auth0",
    azure: "#azure-ad",
    onelogin: "#onelogin",
    jumpcloud: "#jumpcloud",
    oidc: "#generic-open-id-connect",
  };
  return `https://docs.growthbook.io/sso${(idpType && anchors[idpType]) || ""}`;
}
