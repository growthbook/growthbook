import type { Response } from "express";
import { AuthRequest } from "../../types/AuthRequest";
import { ApiErrorResponse } from "../../../types/api";
import { getOrgFromReq } from "../../services/organizations";
import { SlackIntegrationInterface } from "../../../types/slack-integration";
import * as SlackIntegration from "../../models/SlackIntegrationModel";
import { NotificationEventName } from "../../events/base-types";

// region GET /integrations/slack

type GetSlackIntegrationsRequest = AuthRequest<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>
>;

type GetSlackIntegrationsResponse = {
  slackIntegrations: SlackIntegrationInterface[];
};

/**
 * GET /integrations/slack
 * Get all integrations/slack resources
 * @param req
 * @param res
 */
export const getSlackIntegrations = async (
  req: GetSlackIntegrationsRequest,
  res: Response<GetSlackIntegrationsResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageIntegrations");

  const { org } = getOrgFromReq(req);

  const slackIntegrations = await SlackIntegration.getSlackIntegrations(org.id);

  return res.json({
    slackIntegrations,
  });
};

// endregion GET /integrations/slack

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
  res: Response<GetSlackIntegrationResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageIntegrations");

  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  const slackIntegration = await SlackIntegration.getSlackIntegration({
    slackIntegrationId: id,
    organizationId: org.id,
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
  res: Response<CreateSlackIntegrationResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageIntegrations");

  const { org } = getOrgFromReq(req);
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
    organizationId: org.id,
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
  res: Response<PutSlackIntegrationResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageIntegrations");

  const { org } = getOrgFromReq(req);
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
      organizationId: org.id,
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
    }
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
  res: Response<DeleteSlackIntegrationResponse | ApiErrorResponse>
) => {
  req.checkPermissions("manageIntegrations");

  const { org } = getOrgFromReq(req);
  const successful = await SlackIntegration.deleteSlackIntegration({
    slackIntegrationId: req.params.id,
    organizationId: org.id,
  });

  const status = successful ? 200 : 404;

  res.status(status).json({
    status,
  });
};

// endregion DELETE /integrations/slack/:id
