import { z } from "zod";
import {
  deleteInviteValidator,
  listInvitesValidator,
  listPendingMembersValidator,
  postInviteResendValidator,
  postInviteValidator,
  postPendingMemberApproveValidator,
  putInviteValidator,
} from "shared/validators";
import { getDefaultRole } from "shared/permissions";
import {
  Invite,
  MemberRoleWithProjects,
  PendingMember,
} from "shared/types/organization";
import {
  findOrganizationById,
  updateOrganization,
} from "back-end/src/models/OrganizationModel";
import {
  addMemberToOrg,
  assertMemberRoleInfoValid,
  assertProjectRulesReferenceProjects,
  assertRoleChangeAllowed,
  getInviteUrl,
  inviteUser,
  revokeInvite,
} from "back-end/src/services/organizations";
import {
  sendInviteEmail,
  sendPendingMemberApprovalEmail,
} from "back-end/src/services/email";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { ApiReqContext, ApiRequestLocals } from "back-end/types/api";
import { APP_ORIGIN } from "back-end/src/util/secrets";
import { logger } from "back-end/src/util/logger";
import { createApiRequestHandler } from "back-end/src/util/handler";

type RoleInput = z.infer<typeof putInviteValidator.bodySchema>;

// As in updateMemberRole, an environment list is its own limit.
function toRoleInfo(
  input: RoleInput,
  fallback: MemberRoleWithProjects,
): MemberRoleWithProjects {
  const limit = <T extends { environments: string[] }>(e: T) => ({
    ...e,
    limitAccessByEnvironment: !!e.environments.length,
  });
  return {
    role: input.role ?? fallback.role,
    environments: input.environments ?? fallback.environments,
    limitAccessByEnvironment: input.environments
      ? !!input.environments.length
      : fallback.limitAccessByEnvironment,
    additionalRoles:
      input.additionalRoles?.map(limit) ?? fallback.additionalRoles,
    projectRoles:
      input.projectRoles?.map((pr) => ({
        ...limit(pr),
        additionalRoles: pr.additionalRoles?.map(limit),
      })) ?? fallback.projectRoles,
  };
}

// Never includes `key`: it is the secret the invite link carries.
function toApiInvite(invite: Invite) {
  return {
    email: invite.email,
    role: invite.role,
    limitAccessByEnvironment: invite.limitAccessByEnvironment,
    environments: invite.environments,
    additionalRoles: invite.additionalRoles,
    projectRoles: invite.projectRoles,
    invitedBy: invite.invitedBy,
    dateCreated: new Date(invite.dateCreated).toISOString(),
  };
}

function toApiPendingMember(member: PendingMember) {
  return {
    id: member.id,
    name: member.name,
    email: member.email,
    role: member.role,
    limitAccessByEnvironment: member.limitAccessByEnvironment,
    environments: member.environments,
    additionalRoles: member.additionalRoles,
    projectRoles: member.projectRoles,
    dateCreated: new Date(member.dateCreated).toISOString(),
  };
}

function assertCanManageTeam(context: ApiReqContext) {
  if (!context.permissions.canManageTeam()) {
    context.permissions.throwPermissionError();
  }
}

function findInvite(invites: Invite[], email: string) {
  return invites.find((i) => i.email.toLowerCase() === email.toLowerCase());
}

function getInvite(context: ApiReqContext, email: string) {
  const invite = findInvite(context.org.invites, email);
  if (!invite) context.throwNotFoundError(`No invite for ${email}`);
  return invite;
}

async function auditInvite(
  req: Pick<ApiRequestLocals, "audit" | "context">,
  before: Invite | undefined,
  after: Invite | undefined,
) {
  await req.audit({
    event: "organization.update",
    entity: { object: "organization", id: req.context.org.id },
    details: auditDetailsUpdate(
      { invite: before && toApiInvite(before) },
      { invite: after && toApiInvite(after) },
    ),
  });
}

async function assertRoleInfoValid(
  context: ApiReqContext,
  roleInfo: MemberRoleWithProjects,
  existing?: MemberRoleWithProjects,
) {
  try {
    assertMemberRoleInfoValid(context.org, roleInfo);
    await assertProjectRulesReferenceProjects(
      context,
      existing?.projectRoles,
      roleInfo.projectRoles,
    );
  } catch (e) {
    context.throwBadRequestError(e.message);
  }
}

export const listInvites = createApiRequestHandler(listInvitesValidator)(async (
  req,
) => {
  assertCanManageTeam(req.context);
  return { invites: req.context.org.invites.map(toApiInvite) };
});

export const postInvite = createApiRequestHandler(postInviteValidator)(async (
  req,
) => {
  assertCanManageTeam(req.context);
  const { org } = req.context;
  const { email, ...input } = req.body;

  const roleInfo = toRoleInfo(input, getDefaultRole(org));
  await assertRoleInfoValid(req.context, roleInfo);

  const { emailSent, inviteUrl } = await inviteUser({
    organization: org,
    email,
    ...roleInfo,
    invitedBy: req.context.email || undefined,
  });

  const invite = findInvite(
    (await findOrganizationById(org.id))?.invites ?? [],
    email.trim(),
  );
  if (!invite) throw new Error("Unable to create invite");
  if (!findInvite(org.invites, invite.email)) {
    await auditInvite(req, undefined, invite);
  }

  return { invite: toApiInvite(invite), inviteUrl, emailSent };
});

export const putInvite = createApiRequestHandler(putInviteValidator)(async (
  req,
) => {
  assertCanManageTeam(req.context);
  const { org } = req.context;
  const existing = getInvite(req.context, req.params.email);

  const roleInfo = toRoleInfo(req.body, existing);
  await assertRoleInfoValid(req.context, roleInfo, existing);
  // Only gate a role change so existing invites keep working
  assertRoleChangeAllowed(org, existing.role, roleInfo.role);

  const updated: Invite = { ...existing, ...roleInfo };
  await updateOrganization(org.id, {
    invites: org.invites.map((i) => (i.key === existing.key ? updated : i)),
  });
  await auditInvite(req, existing, updated);

  return { invite: toApiInvite(updated) };
});

export const postInviteResend = createApiRequestHandler(
  postInviteResendValidator,
)(async (req) => {
  assertCanManageTeam(req.context);
  const invite = getInvite(req.context, req.params.email);

  let emailSent = true;
  try {
    await sendInviteEmail(req.context.org, invite.key);
  } catch (e) {
    logger.error(e, "Error sending invite email");
    emailSent = false;
  }
  return { inviteUrl: getInviteUrl(invite.key), emailSent };
});

export const deleteInvite = createApiRequestHandler(deleteInviteValidator)(
  async (req) => {
    assertCanManageTeam(req.context);
    const invite = getInvite(req.context, req.params.email);
    await revokeInvite(req.context.org, invite.key);
    await auditInvite(req, invite, undefined);
    return { deletedId: invite.email };
  },
);

export const listPendingMembers = createApiRequestHandler(
  listPendingMembersValidator,
)(async (req) => {
  assertCanManageTeam(req.context);
  return {
    pendingMembers: (req.context.org.pendingMembers ?? []).map(
      toApiPendingMember,
    ),
  };
});

export const postPendingMemberApprove = createApiRequestHandler(
  postPendingMemberApproveValidator,
)(async (req) => {
  assertCanManageTeam(req.context);
  const { org } = req.context;
  const pending = org.pendingMembers?.find((m) => m.id === req.params.id);
  if (!pending) {
    return req.context.throwNotFoundError("Cannot find pending member");
  }

  await addMemberToOrg({
    organization: org,
    userId: pending.id,
    role: pending.role,
    limitAccessByEnvironment: pending.limitAccessByEnvironment,
    environments: pending.environments,
    projectRoles: pending.projectRoles,
  });

  try {
    await sendPendingMemberApprovalEmail(
      pending.name || "",
      pending.email || "",
      org.name,
      APP_ORIGIN + "/?org=" + org.id,
    );
  } catch (e) {
    logger.error(e, "Failed to send pending member approval email");
  }

  return { approvedId: pending.id };
});
