import type { IssuerMetadata } from "openid-client";
import type { SSOConnectionInterface } from "shared/types/sso-connection";
import { stringToBoolean } from "../util";

// Self-hosted SSO
function getSSOConfig() {
  if (!process.env.SSO_CONFIG) return null;

  const config: SSOConnectionInterface = JSON.parse(process.env.SSO_CONFIG);
  // Must include clientId and specific metadata
  const requiredMetadataKeys: (keyof IssuerMetadata)[] = [
    "authorization_endpoint",
    "issuer",
    "jwks_uri",
    "id_token_signing_alg_values_supported",
    "token_endpoint",
  ];
  if (!config?.clientId || !config?.metadata) {
    throw new Error("SSO_CONFIG must contain 'clientId' and 'metadata'");
  }

  const missingMetadata = requiredMetadataKeys.filter(
    (k) => !(k in config.metadata),
  );
  if (missingMetadata.length > 0) {
    throw new Error(
      "SSO_CONFIG missing required metadata fields: " +
        missingMetadata.join(", "),
    );
  }

  // Sanity check for GrowthBook Cloud (to avoid misconfigurations)
  if (
    stringToBoolean(process.env.IS_CLOUD) &&
    config?.metadata?.issuer !== "https://growthbook.auth0.com/"
  ) {
    throw new Error("Invalid SSO configuration for GrowthBook Cloud");
  }

  config.id = "";
  return config;
}
export const SSO_CONFIG = getSSOConfig();
