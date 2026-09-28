import type { Response } from "express";
import countBy from "lodash/countBy";
import { OAuthAppInterface, OAuthAppProps } from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import {
  listOrgGrants,
  revokeAllGrantsForClient,
  revokeMemberGrant,
} from "back-end/src/services/oauth";
import { OAUTH_AS_ENABLED } from "back-end/src/util/secrets";
import {
  createOrgOAuthApp,
  deleteOrgOAuthApp,
  getOrgOAuthApp,
  getOrgOAuthApps,
  rotateOrgOAuthAppSecret,
  updateOrgOAuthApp,
} from "back-end/src/models/OAuthClientModel";

type ClientIdParams = { clientId: string };

function assertCanManageOAuthApps(context: ReqContext) {
  if (!context.permissions.canCreateApiKey()) {
    context.permissions.throwPermissionError();
  }
}

// Downgraded orgs keep using their apps but can't create or change them; delete stays open.
function assertPlanAllowsOAuthApps(context: ReqContext) {
  if (!context.hasPremiumFeature("oauth-apps")) {
    context.throwPlanDoesNotAllowError(
      "OAuth apps require an Enterprise plan.",
    );
  }
}

async function getAppOrThrow(
  context: ReqContext,
  clientId: string,
): Promise<OAuthAppInterface> {
  const app = await getOrgOAuthApp(context.org.id, clientId);
  if (!app) context.throwNotFoundError("OAuth app not found");
  return app;
}

export async function getOAuthApps(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  assertCanManageOAuthApps(context);

  const [apps, grants] = await Promise.all([
    getOrgOAuthApps(context.org.id),
    context.models.oauthGrants.dangerousGetAllActiveForOrg(),
  ]);
  const authorizedUsers = countBy(grants, "clientId");

  res.status(200).json({
    status: 200,
    oauthServerEnabled: OAUTH_AS_ENABLED,
    apps: apps.map((app) => ({
      ...app,
      authorizedUsers: authorizedUsers[app.clientId] ?? 0,
    })),
  });
}

export async function postOAuthApp(
  req: AuthRequest<OAuthAppProps>,
  res: Response,
) {
  const context = getContextFromReq(req);
  assertCanManageOAuthApps(context);
  assertPlanAllowsOAuthApps(context);

  const { app, clientSecret } = await createOrgOAuthApp(
    context.org.id,
    context.userId,
    req.body,
  );
  await req.audit({
    event: "oauthApp.create",
    entity: { object: "oauthApp", id: app.clientId, name: app.clientName },
    details: auditDetailsCreate(app),
  });

  res.status(200).json({ status: 200, app, clientSecret });
}

export async function putOAuthApp(
  req: AuthRequest<OAuthAppProps, ClientIdParams>,
  res: Response,
) {
  const context = getContextFromReq(req);
  assertCanManageOAuthApps(context);
  assertPlanAllowsOAuthApps(context);
  const existing = await getAppOrThrow(context, req.params.clientId);

  const app =
    (await updateOrgOAuthApp(context.org.id, existing.clientId, req.body)) ??
    context.throwNotFoundError("OAuth app not found");
  await req.audit({
    event: "oauthApp.update",
    entity: { object: "oauthApp", id: app.clientId, name: app.clientName },
    details: auditDetailsUpdate(existing, app),
  });

  res.status(200).json({ status: 200, app });
}

export async function postOAuthAppSecret(
  req: AuthRequest<null, ClientIdParams>,
  res: Response,
) {
  const context = getContextFromReq(req);
  assertCanManageOAuthApps(context);
  assertPlanAllowsOAuthApps(context);
  const app = await getAppOrThrow(context, req.params.clientId);

  const clientSecret = await rotateOrgOAuthAppSecret(
    context.org.id,
    app.clientId,
  );
  if (!clientSecret) context.throwNotFoundError("OAuth app not found");
  await req.audit({
    event: "oauthApp.rotateSecret",
    entity: { object: "oauthApp", id: app.clientId, name: app.clientName },
  });

  res.status(200).json({ status: 200, clientSecret });
}

export async function deleteOAuthApp(
  req: AuthRequest<null, ClientIdParams>,
  res: Response,
) {
  const context = getContextFromReq(req);
  if (!context.permissions.canDeleteApiKey()) {
    context.permissions.throwPermissionError();
  }
  const app = await getAppOrThrow(context, req.params.clientId);

  // Revoke before and after: a consent in flight during the first pass can re-arm its grant.
  await revokeAllGrantsForClient(context, app.clientId);
  await deleteOrgOAuthApp(context.org.id, app.clientId);
  await revokeAllGrantsForClient(context, app.clientId);
  await req.audit({
    event: "oauthApp.delete",
    entity: { object: "oauthApp", id: app.clientId, name: app.clientName },
    details: auditDetailsDelete(app),
  });

  res.status(200).json({ status: 200 });
}

export async function getOAuthGrants(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  assertCanManageOAuthApps(context);

  res.status(200).json({ status: 200, grants: await listOrgGrants(context) });
}

export async function postRevokeOAuthGrant(
  req: AuthRequest<{ clientId: string; userId: string }>,
  res: Response,
) {
  const context = getContextFromReq(req);
  if (!context.permissions.canDeleteApiKey()) {
    context.permissions.throwPermissionError();
  }

  await revokeMemberGrant(context, req.body.clientId, req.body.userId);
  res.status(200).json({ status: 200 });
}
