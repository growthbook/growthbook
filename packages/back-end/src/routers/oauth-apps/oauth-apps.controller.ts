import type { Response } from "express";
import countBy from "lodash/countBy";
import { OAuthAppProps, OrgOAuthClientInterface } from "shared/validators";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ReqContext } from "back-end/types/request";
import { getContextFromReq } from "back-end/src/services/organizations";
import {
  disableDelegatedTokens,
  listOrgGrants,
  revokeAllGrantsForClient,
  revokeMemberGrant,
} from "back-end/src/services/oauth";
import { OAUTH_AS_ENABLED } from "back-end/src/util/secrets";
import { OrgOAuthClientModel } from "back-end/src/models/OrgOAuthClientModel";

type ClientIdParams = { clientId: string };

function assertCanManageOAuthApps(context: ReqContext) {
  if (!context.permissions.canManageOAuthApps()) {
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
): Promise<OrgOAuthClientInterface> {
  const app = await context.models.orgOAuthClients.getById(clientId);
  if (!app) context.throwNotFoundError("OAuth app not found");
  return app;
}

export async function getOAuthApps(req: AuthRequest, res: Response) {
  const context = getContextFromReq(req);
  assertCanManageOAuthApps(context);

  const [apps, grants] = await Promise.all([
    context.models.orgOAuthClients.getAll(),
    context.models.oauthGrants.dangerousGetAllActiveForOrg(),
  ]);
  const authorizedUsers = countBy(grants, "clientId");

  res.status(200).json({
    status: 200,
    oauthServerEnabled: OAUTH_AS_ENABLED,
    apps: apps
      .sort((a, b) => b.dateCreated.getTime() - a.dateCreated.getTime())
      .map((app) => ({
        ...OrgOAuthClientModel.toPublic(app),
        authorizedUsers: authorizedUsers[app.id] ?? 0,
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

  const { client: app, clientSecret } =
    await context.models.orgOAuthClients.createClient(req.body);
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

  const app = await context.models.orgOAuthClients.updateClient(
    existing,
    req.body,
  );
  if (existing.allowDelegation && !app.allowDelegation) {
    await disableDelegatedTokens(context, app.clientId);
  }
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

  const clientSecret = await context.models.orgOAuthClients.rotateSecret(app);
  // The old secret may be why they rotated; don't leave tokens it minted working.
  await disableDelegatedTokens(context, app.id);
  res.status(200).json({ status: 200, clientSecret });
}

export async function deleteOAuthApp(
  req: AuthRequest<null, ClientIdParams>,
  res: Response,
) {
  const context = getContextFromReq(req);
  assertCanManageOAuthApps(context);
  const app = await getAppOrThrow(context, req.params.clientId);

  // Revoke before and after: a consent in flight during the first pass can re-arm its grant.
  await revokeAllGrantsForClient(context, app.id);
  await context.models.orgOAuthClients.delete(app);
  await revokeAllGrantsForClient(context, app.id);

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
  assertCanManageOAuthApps(context);

  await revokeMemberGrant(context, req.body.clientId, req.body.userId);
  res.status(200).json({ status: 200 });
}
