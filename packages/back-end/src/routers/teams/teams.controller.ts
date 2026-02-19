import type { Response } from "express";
import { areProjectRolesValid, isRoleValid } from "shared/permissions";
import { TeamInterface } from "shared/types/team";
import { MemberRoleWithProjects } from "shared/types/organization";
import { orgHasPremiumFeature } from "back-end/src/enterprise";
import {
  addMembersToTeam,
  getContextFromReq,
  removeMembersFromTeam,
} from "back-end/src/services/organizations";
import { AuthRequest } from "back-end/src/types/AuthRequest";

// region POST /teams

type CreateTeamRequest = AuthRequest<{
  name: string;
  description: string;
  permissions: MemberRoleWithProjects;
  defaultProject: string;
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
  res: Response<CreateTeamResponse>,
) => {
  const context = getContextFromReq(req);
  const { org, userName } = context;
  const { name, description, permissions, defaultProject } = req.body;

  if (!orgHasPremiumFeature(org, "teams")) {
    context.throwPlanDoesNotAllowError(
      "Must have a commercial License Key to create a team.",
    );
  }

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const existingTeamWithName = await context.models.teams.findByName(name);

  if (existingTeamWithName) {
    return res.status(400).json({
      status: 400,
      message:
        "A team already exists with the specified name. Please try a unique name.",
    });
  }

  // Ensure role is valid
  if (
    !isRoleValid(permissions.role, org) ||
    !areProjectRolesValid(permissions.projectRoles, org)
  ) {
    return res.status(400).json({
      status: 400,
      message: "Invalid role",
    });
  }

  const team = await context.models.teams.create({
    name,
    createdBy: userName,
    description,
    defaultProject,
    managedByIdp: false,
    ...permissions,
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
    defaultProject: string;
    members?: string[];
  },
  { id: string }
>;

type PutTeamResponse = {
  status: 200 | 404 | 400;
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
  res: Response<PutTeamResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { name, description, permissions, defaultProject } = req.body;
  const { id } = req.params;

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const team = await context.models.teams.getById(id);

  if (!team) {
    return res.status(404).json({
      status: 404,
      message: "Cannot find team",
    });
  }

  // Ensure role is valid
  if (
    !isRoleValid(permissions.role, org) ||
    !areProjectRolesValid(permissions.projectRoles, org)
  ) {
    return res.status(400).json({
      status: 400,
      message: "Invalid role",
    });
  }

  await context.models.teams.update(team, {
    name,
    description,
    projectRoles: [],
    defaultProject,
    ...permissions,
    managedByIdp: team.managedByIdp,
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
  res: Response<DeleteTeamResponse>,
) => {
  const context = getContextFromReq(req);
  const { id } = req.params;

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const team = await context.models.teams.getById(id);
  if (!team) return context.throwNotFoundError();

  await context.models.teams.delete(team);

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
  res: Response<DeleteTeamResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id } = req.params;
  const { members } = req.body;

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const team = await context.models.teams.getById(id);

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
  res: Response<DeleteTeamResponse>,
) => {
  const context = getContextFromReq(req);
  const { org } = context;
  const { id, memberId } = req.params;

  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }

  const team = await context.models.teams.getById(id);

  if (!team) {
    return res.status(400).json({
      status: 400,
      message: "Team does not exist. Cannot delete member.",
    });
  }

  const member = org.members.find(
    (member) => member.teams?.includes(id) && member.id === memberId,
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

  return res.status(200).json({
    status: 200,
  });
};

// endregion DELETE /teams/:id/member/:memberId
