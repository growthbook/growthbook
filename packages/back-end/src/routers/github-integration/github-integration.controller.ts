import { Response } from "express";
import { getOrgFromReq } from "../../services/organizations";
import { AuthRequest } from "../../types/AuthRequest";
import {
  getGithubIntegrationByOrg,
  createGithubIntegration,
} from "../../models/GithubIntegration";

export const getGithubIntegration = async (req: AuthRequest, res: Response) => {
  req.checkPermissions("manageIntegrations");
  const { org } = getOrgFromReq(req);
  return res.status(200).json({
    status: 200,
    githubIntegration: await getGithubIntegrationByOrg(org.id),
  });
};

export const postGithubIntegration = async (
  req: AuthRequest<{ tokenId: string }>,
  res: Response
) => {
  req.checkPermissions("manageIntegrations");

  const { org, userId } = getOrgFromReq(req);

  if (!req.body.tokenId)
    return res.status(400).json({
      status: 400,
      message: "tokenId is required",
    });

  const created = await createGithubIntegration({
    organization: org.id,
    tokenId: req.body.tokenId,
    createdBy: userId,
  });

  return res.status(201).json({
    status: 201,
    githubIntegration: created,
  });
};
