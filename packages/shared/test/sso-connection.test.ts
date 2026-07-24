import {
  generateSSOConnection,
  getSSOProviderDocsUrl,
} from "../src/util/sso-connection";
import { putSSOConnectionBodyValidator } from "../src/validators/sso-connection";

describe("generateSSOConnection", () => {
  it("generates okta config from a base URL and strips trailing slashes", () => {
    const res = generateSSOConnection({
      idpType: "okta",
      clientId: "client123",
      baseURL: "https://acme.okta.com//",
      metadata: { issuer: "" },
    });
    expect(res.additionalScope).toBe("offline_access");
    expect(res.extraQueryParams).toBeUndefined();
    expect(res.metadata).toEqual({
      issuer: "https://acme.okta.com",
      authorization_endpoint: "https://acme.okta.com/oauth2/v1/authorize",
      id_token_signing_alg_values_supported: ["RS256"],
      jwks_uri: "https://acme.okta.com/oauth2/v1/keys",
      token_endpoint: "https://acme.okta.com/oauth2/v1/token",
      code_challenge_methods_supported: ["S256"],
    });
  });

  it("does not generate okta metadata without a base URL", () => {
    const res = generateSSOConnection({
      idpType: "okta",
      clientId: "client123",
      metadata: { issuer: "" },
    });
    expect(res.metadata).toEqual({ issuer: "" });
  });

  it("generates google config with offline access query params", () => {
    const res = generateSSOConnection({
      idpType: "google",
      clientId: "client123",
      metadata: { issuer: "" },
    });
    expect(res.extraQueryParams).toEqual({
      access_type: "offline",
      prompt: "consent",
    });
    expect(res.additionalScope).toBe("");
    expect(res.metadata.issuer).toBe("https://accounts.google.com");
  });

  it("generates auth0 config from a tenant id and interpolates the client id in the logout endpoint", () => {
    const res = generateSSOConnection({
      idpType: "auth0",
      clientId: "client123",
      tenantId: "acme",
      audience: "https://api.acme.com",
      metadata: { issuer: "" },
    });
    expect(res.metadata.issuer).toBe("https://acme.auth0.com/");
    expect(res.metadata.logout_endpoint).toBe(
      "https://acme.auth0.com/v2/logout?client_id=client123",
    );
    expect(res.metadata.audience).toBe("https://api.acme.com");
  });

  it("generates azure config from a tenant id", () => {
    const res = generateSSOConnection({
      idpType: "azure",
      clientId: "client123",
      tenantId: "tenant-guid",
      metadata: { issuer: "" },
    });
    expect(res.metadata.issuer).toBe(
      "https://login.microsoftonline.com/tenant-guid/v2.0",
    );
    expect(res.metadata.jwks_uri).toBe(
      "https://login.microsoftonline.com/tenant-guid/discovery/v2.0/keys",
    );
  });

  it("generates onelogin config from a base URL", () => {
    const res = generateSSOConnection({
      idpType: "onelogin",
      clientId: "client123",
      baseURL: "https://acme.onelogin.com",
      metadata: { issuer: "" },
    });
    expect(res.metadata.issuer).toBe("https://acme.onelogin.com/oidc/2");
    expect(res.additionalScope).toBe("");
  });

  it("generates fixed jumpcloud config", () => {
    const res = generateSSOConnection({
      idpType: "jumpcloud",
      clientId: "client123",
      metadata: { issuer: "" },
    });
    expect(res.metadata.issuer).toBe("https://oauth.id.jumpcloud.com/");
    expect(res.additionalScope).toBe("offline_access");
  });

  it("keeps values as-is for the generic oidc type", () => {
    const metadata = {
      issuer: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/auth",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/jwks",
      id_token_signing_alg_values_supported: ["RS256"],
    };
    const res = generateSSOConnection({
      idpType: "oidc",
      clientId: "client123",
      additionalScope: "offline_access",
      metadata,
    });
    expect(res.metadata).toEqual(metadata);
    expect(res.additionalScope).toBe("offline_access");
  });
});

describe("getSSOProviderDocsUrl", () => {
  it("links to the provider-specific docs section", () => {
    expect(getSSOProviderDocsUrl("azure")).toBe(
      "https://docs.growthbook.io/sso#azure-ad",
    );
    expect(getSSOProviderDocsUrl("oidc")).toBe(
      "https://docs.growthbook.io/sso#generic-open-id-connect",
    );
    expect(getSSOProviderDocsUrl("okta")).toBe(
      "https://docs.growthbook.io/sso#okta",
    );
  });

  it("falls back to the SSO docs page for unknown or missing providers", () => {
    expect(getSSOProviderDocsUrl()).toBe("https://docs.growthbook.io/sso");
    expect(getSSOProviderDocsUrl("something-else")).toBe(
      "https://docs.growthbook.io/sso",
    );
  });
});

describe("putSSOConnectionBodyValidator", () => {
  const validOidcBody = {
    idpType: "oidc",
    clientId: "client123",
    clientSecret: "",
    additionalScope: "",
    metadata: {
      issuer: "https://idp.example.com",
      authorization_endpoint: "https://idp.example.com/auth",
      token_endpoint: "https://idp.example.com/token",
      jwks_uri: "https://idp.example.com/jwks",
      id_token_signing_alg_values_supported: ["RS256"],
    },
    enforceSSO: false,
  };

  it("accepts a valid generic oidc body", () => {
    expect(putSSOConnectionBodyValidator.safeParse(validOidcBody).success).toBe(
      true,
    );
  });

  it("rejects non-https metadata endpoints", () => {
    const body = {
      ...validOidcBody,
      metadata: {
        ...validOidcBody.metadata,
        token_endpoint: "http://idp.example.com/token",
      },
    };
    expect(putSSOConnectionBodyValidator.safeParse(body).success).toBe(false);
  });

  it("rejects non-https URLs in passthrough metadata keys", () => {
    const body = {
      ...validOidcBody,
      metadata: {
        ...validOidcBody.metadata,
        userinfo_endpoint: "http://idp.example.com/userinfo",
      },
    };
    expect(putSSOConnectionBodyValidator.safeParse(body).success).toBe(false);
  });

  it("rejects attempts to set email domains or the connection id", () => {
    expect(
      putSSOConnectionBodyValidator.safeParse({
        ...validOidcBody,
        emailDomains: ["example.com"],
      }).success,
    ).toBe(false);
    expect(
      putSSOConnectionBodyValidator.safeParse({
        ...validOidcBody,
        id: "someid",
      }).success,
    ).toBe(false);
    expect(
      putSSOConnectionBodyValidator.safeParse({
        ...validOidcBody,
        organization: "org_123",
      }).success,
    ).toBe(false);
  });

  it("rejects tenant ids with unsafe characters", () => {
    expect(
      putSSOConnectionBodyValidator.safeParse({
        idpType: "azure",
        clientId: "client123",
        clientSecret: "secret",
        tenantId: "foo/../bar",
        enforceSSO: false,
      }).success,
    ).toBe(false);
  });

  it("rejects non-https base URLs", () => {
    expect(
      putSSOConnectionBodyValidator.safeParse({
        idpType: "okta",
        clientId: "client123",
        clientSecret: "secret",
        baseURL: "http://acme.okta.com",
        enforceSSO: false,
      }).success,
    ).toBe(false);
  });
});
