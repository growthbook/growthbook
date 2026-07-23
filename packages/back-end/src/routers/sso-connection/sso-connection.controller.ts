import { Response } from "express";
import uniqid from "uniqid";
import { SSO_CONFIG } from "shared/enterprise";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import {
  PostSSOConnectionEnforceBody,
  PutSSOConnectionBody,
} from "shared/validators";
import {
  generateSSOConnection,
  ssoProviderRequiresBaseURL,
  ssoProviderRequiresTenantId,
} from "shared/util";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { IS_CLOUD } from "back-end/src/util/secrets";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  _dangerousCreateSSOConnection,
  _dangerousDeleteSSOConnection,
  _dangerousUpdateSSOConnection,
  getSSOConnectionByOrganization,
  redactSSOConnectionClientSecret,
} from "back-end/src/models/SSOConnectionModel";
import { updateOrganization } from "back-end/src/models/OrganizationModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";

// The full connection minus the client secret, for org admins to view/edit
function toSelfServeSSOConnection(
  conn: SSOConnectionInterface | null,
): Partial<SSOConnectionInterface> | null {
  if (!conn) return null;
  return {
    id: conn.id,
    dateCreated: conn.dateCreated,
    dateUpdated: conn.dateUpdated,
    idpType: conn.idpType,
    clientId: conn.clientId,
    clientSecret: conn.clientSecret ? "********" : "",
    emailDomains: conn.emailDomains || [],
    additionalScope: conn.additionalScope || "",
    extraQueryParams: conn.extraQueryParams || {},
    metadata: conn.metadata,
    baseURL: conn.baseURL || "",
    tenantId: conn.tenantId || "",
    audience: conn.audience || "",
    selfServeManaged: !!conn.selfServeManaged,
  };
}

export async function getSSOConnection(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  const connection = await getSSOConnectionByOrganization(context.org.id);

  // Self-hosted may have deployment-wide SSO via the SSO_CONFIG environment
  // variable; return it (redacted) so the settings page can show it read-only
  if (!connection && !IS_CLOUD && SSO_CONFIG) {
    return res.status(200).json({
      status: 200,
      ssoConnection: toSelfServeSSOConnection(SSO_CONFIG),
      managedByEnv: true,
      enforceSSO: false,
      loggedInViaConnection: false,
    });
  }

  res.status(200).json({
    status: 200,
    ssoConnection: toSelfServeSSOConnection(connection),
    managedByEnv: false,
    enforceSSO:
      !!connection?.id && context.org.restrictLoginMethod === connection.id,
    loggedInViaConnection:
      !!connection?.id && req.loginMethod?.id === connection.id,
  });
}

export async function putSSOConnection(
  req: AuthRequest<PutSSOConnectionBody>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }
  if (!context.hasPremiumFeature("sso")) {
    throw new Error("Your plan does not cover managing an SSO connection");
  }

  const {
    idpType,
    clientId,
    clientSecret,
    baseURL,
    tenantId,
    audience,
    additionalScope,
    metadata,
    extraQueryParams,
    enforceSSO,
  } = req.body;

  // Derive the connection config. For known providers, the OIDC endpoints are
  // always generated server-side from the provider-specific fields so the
  // client can't submit arbitrary metadata for them.
  let connectionFields: Partial<SSOConnectionInterface>;
  if (idpType === "oidc") {
    if (!metadata) {
      throw new Error(
        "Metadata is required when using a generic OpenID Connect provider",
      );
    }
    connectionFields = {
      idpType,
      clientId,
      clientSecret,
      additionalScope: additionalScope || "",
      extraQueryParams: extraQueryParams || {},
      metadata,
      baseURL: "",
      tenantId: "",
      audience: "",
    };
  } else {
    if (ssoProviderRequiresBaseURL(idpType) && !baseURL) {
      throw new Error("Base URL is required for this identity provider");
    }
    if (ssoProviderRequiresTenantId(idpType) && !tenantId) {
      throw new Error("Tenant ID is required for this identity provider");
    }
    const generated = generateSSOConnection({
      idpType,
      clientId,
      baseURL,
      tenantId,
      audience,
      metadata: { issuer: "" },
    });
    if (!generated.metadata?.issuer) {
      throw new Error(
        "Could not generate a configuration for the selected identity provider",
      );
    }
    connectionFields = {
      idpType,
      clientId,
      clientSecret,
      additionalScope: generated.additionalScope || "",
      extraQueryParams: generated.extraQueryParams || {},
      metadata: generated.metadata,
      baseURL: baseURL || "",
      tenantId: tenantId || "",
      audience: audience || "",
    };
  }

  const existing = await getSSOConnectionByOrganization(context.org.id);

  // Guard against locking the whole organization out: SSO can only be
  // enforced by an admin who has already signed in through this connection
  const currentEnforce =
    !!existing?.id && context.org.restrictLoginMethod === existing.id;
  if (enforceSSO && !currentEnforce) {
    if (!existing?.id || req.loginMethod?.id !== existing.id) {
      throw new Error(
        "To enforce SSO for your organization, you must first sign in through this SSO connection yourself",
      );
    }
  }
  const newEnforce = enforceSSO ?? currentEnforce;

  // While SSO is enforced, changing any auth-critical field could lock every
  // member out, since nobody can prove the new config works without signing in
  // through it. Issuer/JWKS changes break id_token verification; a clientId
  // change breaks it immediately via the audience check; and wrong OAuth
  // credentials break token exchange and refresh. Require turning enforcement
  // off first, which forces the safe re-verify sequence.
  // An empty clientSecret means "keep existing", so it is not a change.
  const authConfigChanged =
    !!existing &&
    (existing.metadata?.issuer !== connectionFields.metadata?.issuer ||
      existing.metadata?.jwks_uri !== connectionFields.metadata?.jwks_uri ||
      existing.clientId !== connectionFields.clientId ||
      (clientSecret !== "" && clientSecret !== existing.clientSecret));
  if (currentEnforce && authConfigChanged) {
    throw new Error(
      "Turn off enforced SSO sign-in before changing the identity provider or its credentials, then sign in through the updated connection to re-enable it.",
    );
  }
  if (!existing && !clientSecret) {
    throw new Error("Client secret is required to set up an SSO connection");
  }

  let connectionId: string;
  if (existing) {
    const updates: Partial<SSOConnectionInterface> = {
      ...connectionFields,
      selfServeManaged: true,
    };
    // Email domains are vetted by GrowthBook against a specific IdP. If this
    // update changes the token trust anchor, that vetting no longer applies —
    // drop the domains so an unvetted IdP can't mint auto-join logins for them
    if (
      existing.emailDomains?.length &&
      (existing.metadata?.issuer !== connectionFields.metadata?.issuer ||
        existing.metadata?.jwks_uri !== connectionFields.metadata?.jwks_uri)
    ) {
      updates.emailDomains = [];
    }
    await _dangerousUpdateSSOConnection(existing, updates);
    connectionId = existing.id || "";
    await req.audit({
      event: "ssoConnection.update",
      entity: {
        object: "ssoConnection",
        id: connectionId,
      },
      details: auditDetailsUpdate(
        redactSSOConnectionClientSecret(existing),
        redactSSOConnectionClientSecret(updates),
      ),
    });
  } else {
    const created = await _dangerousCreateSSOConnection({
      ...(connectionFields as SSOConnectionInterface),
      id: uniqid("sso_"),
      organization: context.org.id,
      // Email domains allow anyone signing in through the IdP with a matching
      // email to auto-join the organization, so they can only be added by
      // GrowthBook after verifying domain ownership
      emailDomains: [],
      selfServeManaged: true,
    });
    connectionId = created.id || "";
    await req.audit({
      event: "ssoConnection.create",
      entity: {
        object: "ssoConnection",
        id: connectionId,
      },
      details: auditDetailsCreate(redactSSOConnectionClientSecret(created)),
    });
  }

  if (newEnforce !== currentEnforce) {
    const newValue = newEnforce ? connectionId : "";
    await updateOrganization(context.org.id, {
      restrictLoginMethod: newValue,
    });
    await req.audit({
      event: "organization.update",
      entity: {
        object: "organization",
        id: context.org.id,
      },
      details: auditDetailsUpdate(
        { restrictLoginMethod: context.org.restrictLoginMethod },
        { restrictLoginMethod: newValue },
      ),
    });
  }

  const connection = await getSSOConnectionByOrganization(context.org.id);
  res.status(200).json({
    status: 200,
    ssoConnection: toSelfServeSSOConnection(connection),
    enforceSSO: !!connection?.id && newEnforce,
  });
}

export async function postSSOConnectionEnforce(
  req: AuthRequest<PostSSOConnectionEnforceBody>,
  res: Response,
) {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  const { enforce } = req.body;

  // Turning enforcement off is always allowed so organizations that
  // downgraded are not stuck with it on
  if (enforce && !context.hasPremiumFeature("sso")) {
    throw new Error("Your plan does not cover managing an SSO connection");
  }

  const connection = await getSSOConnectionByOrganization(context.org.id);
  if (!connection?.id) {
    throw new Error("Your organization does not have an SSO connection");
  }

  const currentEnforce = context.org.restrictLoginMethod === connection.id;

  // Guard against locking the whole organization out: SSO can only be
  // enforced by an admin who has already signed in through this connection
  if (enforce && !currentEnforce && req.loginMethod?.id !== connection.id) {
    throw new Error(
      "To enforce SSO for your organization, you must first sign in through this SSO connection yourself",
    );
  }

  if (enforce !== currentEnforce) {
    const newValue = enforce ? connection.id : "";
    await updateOrganization(context.org.id, {
      restrictLoginMethod: newValue,
    });
    await req.audit({
      event: "organization.update",
      entity: {
        object: "organization",
        id: context.org.id,
      },
      details: auditDetailsUpdate(
        { restrictLoginMethod: context.org.restrictLoginMethod },
        { restrictLoginMethod: newValue },
      ),
    });
  }

  res.status(200).json({
    status: 200,
    enforceSSO: enforce,
  });
}

export async function deleteSSOConnection(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);

  // No commercial-feature check: organizations that downgraded should still
  // be able to remove their SSO connection
  if (!context.permissions.canManageOrgSettings()) {
    context.permissions.throwPermissionError();
  }

  const connection = await getSSOConnectionByOrganization(context.org.id);
  if (!connection?.id) {
    throw new Error("Your organization does not have an SSO connection");
  }

  // Turn off enforcement first so members aren't locked out of signing in
  if (context.org.restrictLoginMethod === connection.id) {
    await updateOrganization(context.org.id, {
      restrictLoginMethod: "",
    });
    await req.audit({
      event: "organization.update",
      entity: {
        object: "organization",
        id: context.org.id,
      },
      details: auditDetailsUpdate(
        { restrictLoginMethod: context.org.restrictLoginMethod },
        { restrictLoginMethod: "" },
      ),
    });
  }

  await _dangerousDeleteSSOConnection(connection);
  await req.audit({
    event: "ssoConnection.delete",
    entity: {
      object: "ssoConnection",
      id: connection.id,
    },
    details: auditDetailsDelete(redactSSOConnectionClientSecret(connection)),
  });

  res.status(200).json({
    status: 200,
  });
}
