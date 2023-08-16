import type { Response } from "express";
import { TeamInterface } from "../../../types/team";
import {
  createTeam,
  findTeamById,
  getTeamsForOrganization,
} from "../../models/TeamModel";
import { auditDetailsCreate } from "../../services/audit";
import { getOrgFromReq } from "../../services/organizations";
import { AuthRequest } from "../../types/AuthRequest";
import { MemberRoleWithProjects } from "../../../types/organization";

// region POST /teams

type CreateTeamRequest = AuthRequest<{
  name: string;
  createdBy: string;
  description: string;
  permissions: MemberRoleWithProjects;
}>;

type CreateTeamResponse = {
  status: 200;
  team: TeamInterface;
};

/**
 * POST /teams
 * Create a team resource
 * @param req
 * @param res
 */
export const postTeam = async (
  req: CreateTeamRequest,
  res: Response<CreateTeamResponse>
) => {
  const { org } = getOrgFromReq(req);
  const { name, createdBy, description, permissions } = req.body;

  req.checkPermissions("manageTeam");

  const team = await createTeam({
    name,
    createdBy,
    description,
    organization: org.id,
    ...permissions,
  });

  await req.audit({
    event: "team.create",
    entity: {
      object: "team",
      id: team.id,
      name: name,
    },
    details: auditDetailsCreate(team),
  });

  return res.status(200).json({
    status: 200,
    team,
  });
};

// endregion POST /teams

// region GET /teams

type GetTeamsResponse = {
  status: 200;
  teams: TeamInterface[];
};

export const getTeams = async (
  req: AuthRequest,
  res: Response<GetTeamsResponse>
) => {
  const { org } = getOrgFromReq(req);

  req.checkPermissions("manageTeam");

  const teams = await getTeamsForOrganization(org.id);

  return res.status(200).json({
    status: 200,
    teams,
  });
};

// endregion GET /teams

// region GET /teams/:id

type GetTeamRequest = AuthRequest<{
  id: string;
}>;

type GetTeamResponse = {
  status: 200 | 404;
  team?: TeamInterface;
  message?: string;
};

export const getTeamById = async (
  req: GetTeamRequest,
  res: Response<GetTeamResponse>
) => {
  const { org } = getOrgFromReq(req);
  const { id } = req.body;

  req.checkPermissions("manageTeam");

  const team = await findTeamById(id, org.id);

  if (!team) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find team",
    });
  }

  return res.status(200).json({
    status: 200,
    team,
  });
};

// endregion GET /teams/:id
