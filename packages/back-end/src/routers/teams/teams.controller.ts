import type { Response } from "express";
import { TeamInterface } from "../../../types/team";
import {
  createTeam,
  deleteTeam,
  findTeamById,
  getTeamsForOrganization,
  updateTeamMetadata,
} from "../../models/TeamModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../../services/audit";
import {
  expandOrgMembers,
  getOrgFromReq,
  removeMemberFromTeam,
} from "../../services/organizations";
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
  const { org, userName } = getOrgFromReq(req);
  const { name, description, permissions } = req.body;

  req.checkPermissions("manageTeam");

  const team = await createTeam({
    name,
    createdBy: userName,
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

/**
 * GET /teams
 * Get all the teams for the authenticated user's organization
 * @param req
 * @param res
 */
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

type GetTeamResponse = {
  status: 200 | 404;
  team?: TeamInterface;
  message?: string;
};

/**
 * GET /teams/:id
 * Get team document for the given id
 * @param req
 * @param res
 */
export const getTeamById = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<GetTeamResponse>
) => {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  req.checkPermissions("manageTeam");

  const team = await findTeamById(id, org.id);
  const members = org.members.filter((member) => member.teams?.includes(id));
  const expandedMembers = await expandOrgMembers(members);

  if (!team) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find team",
    });
  }

  return res.status(200).json({
    status: 200,
    team: {
      ...team,
      members: expandedMembers,
    },
  });
};

// endregion GET /teams/:id

// region PUT /teams/:id

type PutTeamRequest = AuthRequest<
  {
    name: string;
    createdBy: string;
    description: string;
    permissions: MemberRoleWithProjects;
  },
  { id: string }
>;

type PutTeamResponse = {
  status: 200;
};

/**
 * PUT /teams/:id
 * Update team document for the given id
 * @param req
 * @param res
 */
export const updateTeam = async (
  req: PutTeamRequest,
  res: Response<PutTeamResponse>
) => {
  const { org } = getOrgFromReq(req);
  const { name, description, permissions } = req.body;
  const { id } = req.params;

  req.checkPermissions("manageTeam");

  const team = await findTeamById(id, org.id);

  const changes = await updateTeamMetadata(id, org.id, {
    name,
    description,
    projectRoles: [],
    ...permissions,
  });

  await req.audit({
    event: "team.update",
    entity: {
      object: "team",
      id: id,
      name: name,
    },
    details: auditDetailsUpdate(team, { ...team, ...changes }),
  });

  return res.status(200).json({
    status: 200,
  });
};

// endregion PUT /teams/:id

// region DELETE /teams/:id

/**
 * DELETE /teams/:id
 * Delete team document for given id and remove team id from teams array for any
 * members of the team.
 * @param req
 * @param res
 */
export const deleteTeamById = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<{ status: 200 }>
) => {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  req.checkPermissions("manageTeam");

  const team = await findTeamById(id, org.id);

  const members = org.members.filter((member) => member.teams?.includes(id));

  // Remove members from team to be deleted
  await Promise.all(
    members.map((member) => {
      return removeMemberFromTeam({
        organization: org,
        userId: member.id,
        teamId: id,
      });
    })
  );

  // Delete the team
  await deleteTeam(id, org.id);

  await req.audit({
    event: "team.delete",
    entity: {
      object: "team",
      id,
    },
    details: auditDetailsDelete(team),
  });

  return res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /teams/:id
