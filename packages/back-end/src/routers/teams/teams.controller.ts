import type { Response } from "express";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "@back-end/src/services/audit";
import {
  addMembersToTeam,
  getContextFromReq,
  removeMembersFromTeam,
} from "@back-end/src/services/organizations";
import { TeamInterface } from "@back-end/types/team";
import {
  createTeam,
  deleteTeam,
  findTeamById,
  findTeamByName,
  updateTeamMetadata,
} from "@back-end/src/models/TeamModel";
import { MemberRoleWithProjects } from "@back-end/types/organization";
import { AuthRequest } from "@back-end/src/types/AuthRequest";

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
  const { org, userName } = getContextFromReq(req);
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
  const { org } = getContextFromReq(req);
  const { name, description, permissions } = req.body;
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
    managedByIdp: team.managedByIdp,
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
  const { org } = getContextFromReq(req);
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

  if (team?.managedByIdp) {
    return res.status(400).json({
      status: 400,
      message:
        "Cannot delete a team that is being managed by an idP. Please delete the team through your idP.",
    });
  }

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
  const { org } = getContextFromReq(req);
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

  await addMembersToTeam({
    organization: org,
    userIds: members,
    teamId: team.id,
  });

  const teamMembers = org.members.filter((member) =>
    member.teams?.includes(id)
  );

  await req.audit({
    event: "team.update",
    entity: {
      object: "team",
      id: id,
      name: team.name,
    },
    details: auditDetailsUpdate(team, {
      ...team,
      members: teamMembers.map((m) => m.id),
    }),
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
  const { org } = getContextFromReq(req);
  const { id, memberId } = req.params;

  req.checkPermissions("manageTeam");

  const team = await findTeamById(id, org.id);

  if (!team) {
    return res.status(400).json({
      status: 400,
      message: "Team does not exist. Cannot delete member.",
    });
  }

  const member = org.members.find(
    (member) => member.teams?.includes(id) && member.id === memberId
  );

  if (!member) {
    return res.status(400).json({
      status: 400,
      message: "Cannot delete a member that does not exist in the team",
    });
  }

  // Delete the team member
  await removeMembersFromTeam({
    organization: org,
    userIds: [memberId],
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
      members: team.members?.filter((m) => m !== memberId),
    }),
  });

  return res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /teams/:id/member/:memberId
