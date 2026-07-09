import type { Response } from "express";
import {
  SlackIntegrationInterface,
  SlackOAuthIntegrationInterface,
} from "shared/types/slack-integration";
import { NotificationEventName } from "shared/types/events/base-types";
import { AuthRequest } from "back-end/src/types/AuthRequest";
import { ApiErrorResponse } from "back-end/types/api";
import { getContextFromReq } from "back-end/src/services/organizations";
import * as SlackIntegration from "back-end/src/models/SlackIntegrationModel";
import {
  connectSlackOAuthIntegration,
  connectSlackOAuthInstallFromSession,
  deleteSlackOAuthIntegration,
  getSlackOAuthAuthorizeUrl,
  getSlackOAuthIntegrations,
  isSlackOAuthConfigured,
} from "back-end/src/services/slackIntegration";
import { verifySlackLinkState } from "back-end/src/services/slack/slackLink";
import { upsertSlackUserLink } from "back-end/src/models/SlackUserLinkModel";

// region GET /integrations/slack

type GetSlackIntegrationsRequest = AuthRequest<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>;

type GetSlackIntegrationsResponse = {
  slackIntegrations: SlackOAuthIntegrationInterface[];
  oauthConfigured: boolean;
};

/**
 * GET /integrations/slack
 * Get all integrations/slack resources
 * @param req
 * @param res
 */
export const getSlackIntegrations = async (
  req: GetSlackIntegrationsRequest,
  res: Response<GetSlackIntegrationsResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  const slackIntegrations = await getSlackOAuthIntegrations(context);

  return res.json({
    slackIntegrations,
    oauthConfigured: isSlackOAuthConfigured(),
  });
};

// endregion GET /integrations/slack

// region POST /integrations/slack/connect

type PostSlackOAuthConnectRequest = AuthRequest<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>;

type PostSlackOAuthConnectResponse = {
  url: string;
};

export const postSlackOAuthConnect = async (
  req: PostSlackOAuthConnectRequest,
  res: Response<PostSlackOAuthConnectResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  return res.json({
    url: getSlackOAuthAuthorizeUrl(context),
  });
};

// endregion POST /integrations/slack/connect

// region POST /integrations/slack/oauth-callback

type PostSlackOAuthCallbackRequest = AuthRequest<{
  code: string;
  state: string;
}>;

type PostSlackOAuthCallbackResponse = {
  slackIntegration: SlackOAuthIntegrationInterface;
};

export const postSlackOAuthCallback = async (
  req: PostSlackOAuthCallbackRequest,
  res: Response<PostSlackOAuthCallbackResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  const slackIntegration = await connectSlackOAuthIntegration({
    context,
    code: req.body.code,
    state: req.body.state,
  });

  return res.json({
    slackIntegration,
  });
};

// endregion POST /integrations/slack/oauth-callback

// region POST /integrations/slack/oauth-install

// Slack-initiated install (App Directory "Add to Slack"): Slack returns a
// `code` with no GrowthBook `state`, so the attach is authorized by the
// logged-in session + this permission check + the org the user confirmed in
// the UI (sent via the X-Organization header), rather than a signed state.
type PostSlackOAuthInstallRequest = AuthRequest<{
  code: string;
}>;

type PostSlackOAuthInstallResponse = {
  slackIntegration: SlackOAuthIntegrationInterface;
};

export const postSlackOAuthInstall = async (
  req: PostSlackOAuthInstallRequest,
  res: Response<PostSlackOAuthInstallResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  const slackIntegration = await connectSlackOAuthInstallFromSession({
    context,
    code: req.body.code,
  });

  return res.json({
    slackIntegration,
  });
};

// endregion POST /integrations/slack/oauth-install

// region POST /integrations/slack/link

// Complete the Slack account-link flow: the signed `state` proves the request
// came from the bot for a specific Slack user; the session proves the acting
// GrowthBook identity. We record the mapping so the assistant acts as this
// user going forward (replacing the untrusted Slack profile email).
type PostSlackLinkRequest = AuthRequest<{ state: string }>;

export const postSlackLink = async (
  req: PostSlackLinkRequest,
  res: Response<{ linked: boolean } | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  const parsed = verifySlackLinkState(req.body.state);
  if (!parsed) {
    return res.status(400).json({
      message:
        "This link is invalid or expired. Mention the bot again to get a fresh link.",
    });
  }

  await upsertSlackUserLink({
    slackTeamId: parsed.slackTeamId,
    slackUserId: parsed.slackUserId,
    organizationId: context.org.id,
    growthbookUserId: context.userId,
  });

  return res.json({ linked: true });
};

// endregion POST /integrations/slack/link

// region GET /integrations/slack/:id

type GetSlackIntegrationRequest = AuthRequest<
  Record<string, never>,
  { id: string },
  Record<string, never>
>;

type GetSlackIntegrationResponse = {
  slackIntegration: SlackIntegrationInterface;
};

/**
 * GET /integrations/slack/:id
 * Get one integrations/slack resource by ID
 * @param req
 * @param res
 */
export const getSlackIntegration = async (
  req: GetSlackIntegrationRequest,
  res: Response<GetSlackIntegrationResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  const { id } = req.params;

  const slackIntegration = await SlackIntegration.getSlackIntegration({
    slackIntegrationId: id,
    organizationId: context.org.id,
  });
  if (!slackIntegration) {
    return res.status(404).json({ message: "Not found" });
  }

  return res.json({
    slackIntegration,
  });
};

// endregion GET /integrations/slack/:id

// region POST /integrations/slack

type CreateSlackIntegrationRequest = AuthRequest<{
  name: string;
  description: string;
  projects: string[];
  environments: string[];
  events: NotificationEventName[];
  tags: string[];
  slackAppId: string;
  slackSigningKey: string;
  slackIncomingWebHook: string;
}>;

type CreateSlackIntegrationResponse = {
  slackIntegration: SlackIntegrationInterface;
};

/**
 * POST /integrations/slack
 * Create a integrations/slack resource
 * @param req
 * @param res
 */
export const postSlackIntegration = async (
  req: CreateSlackIntegrationRequest,
  res: Response<CreateSlackIntegrationResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }

  const {
    name,
    events,
    description,
    environments,
    projects,
    slackAppId,
    slackSigningKey,
    slackIncomingWebHook,
    tags,
  } = req.body;

  const created = await SlackIntegration.createSlackIntegration({
    organizationId: context.org.id,
    name,
    events,
    description,
    environments,
    projects,
    slackAppId,
    slackSigningKey,
    slackIncomingWebHook,
    tags,
    linkedByUserId: req.userId as string,
  });

  return res.json({ slackIntegration: created });
};

// endregion POST /integrations/slack

// region PUT /integrations/slack/:id

type PutSlackIntegrationRequest = AuthRequest<
  {
    name: string;
    description: string;
    projects: string[];
    environments: string[];
    events: NotificationEventName[];
    tags: string[];
    slackAppId: string;
    slackSigningKey: string;
    slackIncomingWebHook: string;
  },
  { id: string }
>;

type PutSlackIntegrationResponse = {
  status: number;
};

/**
 * PUT /integrations/slack/:id
 * Update one integrations/slack resource
 * @param req
 * @param res
 */
export const putSlackIntegration = async (
  req: PutSlackIntegrationRequest,
  res: Response<PutSlackIntegrationResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);

  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }
  const {
    name,
    events,
    description,
    environments,
    projects,
    slackAppId,
    slackSigningKey,
    slackIncomingWebHook,
    tags,
  } = req.body;

  const successful = await SlackIntegration.updateSlackIntegration(
    {
      organizationId: context.org.id,
      slackIntegrationId: req.params.id,
    },
    {
      name,
      events,
      description,
      environments,
      projects,
      slackAppId,
      slackSigningKey,
      slackIncomingWebHook,
      tags,
    },
  );

  const status = successful ? 200 : 404;

  res.status(status).json({
    status,
  });
};

// endregion PUT /integrations/slack/:id

// region DELETE /integrations/slack/:id

type DeleteSlackIntegrationRequest = AuthRequest<null, { id: string }>;

type DeleteSlackIntegrationResponse = {
  status: number;
};

/**
 * DELETE /integrations/slack/:id
 * Delete one integrations/slack resource by ID
 * @param req
 * @param res
 */
export const deleteSlackIntegration = async (
  req: DeleteSlackIntegrationRequest,
  res: Response<DeleteSlackIntegrationResponse | ApiErrorResponse>,
) => {
  const context = getContextFromReq(req);
  if (!context.permissions.canManageIntegrations()) {
    context.permissions.throwPermissionError();
  }
  const successful =
    (await deleteSlackOAuthIntegration({
      context,
      id: req.params.id,
    })) ||
    (await SlackIntegration.deleteSlackIntegration({
      slackIntegrationId: req.params.id,
      organizationId: context.org.id,
    }));

  const status = successful ? 200 : 404;

  res.status(status).json({
    status,
  });
};

// endregion DELETE /integrations/slack/:id
