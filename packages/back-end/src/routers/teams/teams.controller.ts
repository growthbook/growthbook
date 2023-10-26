import type { Response } from "express";
import { TeamInterface } from "../../../types/team";
import {
  createTeam,
  deleteTeam,
  findTeamById,
  findTeamByName,
  getTeamsForOrganization,
  updateTeamMetadata,
} from "../../models/TeamModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "../../services/audit";
import {
  addMemberToTeam,
  expandOrgMembers,
  getOrgFromReq,
  removeMemberFromTeam,
} from "../../services/organizations";
import { AuthRequest } from "../../types/AuthRequest";
import { Member, MemberRoleWithProjects } from "../../../types/organization";

// region POST /teams

type CreateTeamRequest = AuthRequest<{
  name: string;
  description: string;
  permissions: MemberRoleWithProjects;
}>;

type CreateTeamResponse = {
  status: 200 | 400;
  team?: TeamInterface;
  message?: string;
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

  const existingTeamWithName = await findTeamByName(name, org.id);

  if (existingTeamWithName) {
    return res.status(400).json({
      status: 400,
      message:
        "A team already exists with the specified name. Please try a unique name.",
    });
  }

  const team = await createTeam({
    name,
    createdBy: userName,
    description,
    organization: org.id,
    managedByIdp: false,
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

  const teamsWithMembersP = teams.map(async (team) => {
    const members = org.members.filter((member) =>
      member.teams?.includes(team.id)
    );
    const expandedMembers = await expandOrgMembers(members);
    return {
      ...team,
      members: expandedMembers,
    };
  });

  const teamsWithMembers = await Promise.all(teamsWithMembersP);

  return res.status(200).json({
    status: 200,
    teams: teamsWithMembers,
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
    description: string;
    permissions: MemberRoleWithProjects;
    members?: string[];
  },
  { id: string }
>;

type PutTeamResponse = {
  status: 200 | 404;
  message?: string;
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
  const { name, description, permissions, members } = req.body;
  const { id } = req.params;

  req.checkPermissions("manageTeam");

  const team = await findTeamById(id, org.id);

  if (!team) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find team",
    });
  }

  const changes = await updateTeamMetadata(id, org.id, {
    name,
    description,
    projectRoles: [],
    ...permissions,
  });

  // If making changes to members remove members and add new requested members
  if (members) {
    const prevMembers: Member[] = org.members.filter((member) =>
      member.teams?.includes(id)
    );
    await Promise.all(
      prevMembers.map((member) => {
        return removeMemberFromTeam({
          organization: org,
          userId: member.id,
          teamId: id,
        });
      })
    );
    await Promise.all(
      members.map((member) => {
        return addMemberToTeam({
          organization: org,
          userId: member,
          teamId: id,
        });
      })
    );
  }

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

type DeleteTeamResponse = {
  status: 200 | 400;
  message?: string;
};
/**
 * DELETE /teams/:id
 * Delete team document for given id and remove team id from teams array for any
 * members of the team.
 * @param req
 * @param res
 */
export const deleteTeamById = async (
  req: AuthRequest<null, { id: string }>,
  res: Response<DeleteTeamResponse>
) => {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;

  req.checkPermissions("manageTeam");

  const team = await findTeamById(id, org.id);

  const members = org.members.filter((member) => member.teams?.includes(id));

  if (members.length !== 0) {
    return res.status(400).json({
      status: 400,
      message:
        "Cannot delete a team that has members. Please delete members before retrying.",
    });
  }

  // TODO: Replace error above with code below once we add a double confirm delete dialog for team deletion in the UI

  // // Remove members from team to be deleted
  // await Promise.all(
  //   members.map((member) => {
  //     return removeMemberFromTeam({
  //       organization: org,
  //       userId: member.id,
  //       teamId: id,
  //     });
  //   })
  // );

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

// region POST /teams/:id/members

/**
 * POST /teams/:id/members
 * Add users in the list to the team
 * @param req
 * @param res
 */
export const addTeamMembers = async (
  req: AuthRequest<{ members: string[] }, { id: string }>,
  res: Response<DeleteTeamResponse>
) => {
  const { org } = getOrgFromReq(req);
  const { id } = req.params;
  const { members } = req.body;

  req.checkPermissions("manageTeam");

  const team = await findTeamById(id, org.id);

  if (!team) {
    return res.status(400).json({
      status: 400,
      message: "Team does not exist. Cannot add members.",
    });
  }

  await Promise.all(
    members.map((member) => {
      return addMemberToTeam({
        organization: org,
        userId: member,
        teamId: team.id,
      });
    })
  );

  const teamMembers = org.members.filter((member) =>
    member.teams?.includes(id)
  );
  const expandedMembers = await expandOrgMembers(teamMembers);

  await req.audit({
    event: "team.update",
    entity: {
      object: "team",
      id: id,
      name: team.name,
    },
    details: auditDetailsUpdate(team, { ...team, members: expandedMembers }),
  });

  return res.status(200).json({
    status: 200,
  });
};

// region DELETE /teams/:id/member/:memberId

/**
 * DELETE /teams/:id/member/:memberId
 * Delete team member for given member id
 * members of the team.
 * @param req
 * @param res
 */
export const deleteTeamMember = async (
  req: AuthRequest<null, { id: string; memberId: string }>,
  res: Response<DeleteTeamResponse>
) => {
  const { org } = getOrgFromReq(req);
  const { id, memberId } = req.params;

  req.checkPermissions("manageTeam");

  const team = await findTeamById(id, org.id);

  if (!team) {
    return res.status(400).json({
      status: 400,
      message: "Team does not exist. Cannot delete member.",
    });
  }

  const member = org.members.filter(
    (member) => member.teams?.includes(id) && member.id === memberId
  );

  if (!member) {
    return res.status(400).json({
      status: 400,
      message: "Cannot delete a member that does not exist in the team",
    });
  }

  // Delete the team member
  await removeMemberFromTeam({
    organization: org,
    userId: memberId,
    teamId: id,
  });

  await req.audit({
    event: "team.update",
    entity: {
      object: "team",
      id: id,
      name: team.name,
    },
    details: auditDetailsUpdate(team, {
      ...team,
      members: team.members?.filter((m) => m.id !== memberId),
    }),
  });

  return res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /teams/:id/member/:memberId
