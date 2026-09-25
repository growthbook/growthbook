import {
  deleteRoleValidator,
  listRolesValidator,
  postRoleActivateValidator,
  postRoleDeactivateValidator,
  postRoleValidator,
  putRoleValidator,
} from "shared/validators";
import { getRoles, RESERVED_ROLE_IDS } from "shared/permissions";
import { OrganizationInterface, Role } from "shared/types/organization";
import {
  activateRoleById,
  addCustomRole,
  deactivateRoleById,
  editCustomRole,
  removeCustomRole,
} from "back-end/src/models/OrganizationModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { ApiReqContext, ApiRequestLocals } from "back-end/types/api";
import { createApiRequestHandler } from "back-end/src/util/handler";

function toApiRole(
  role: Role,
  org: Pick<OrganizationInterface, "deactivatedRoles">,
) {
  return {
    id: role.id,
    displayName: role.displayName,
    description: role.description,
    policies: role.policies,
    isCustom: !RESERVED_ROLE_IDS.includes(role.id),
    deactivated: !!org.deactivatedRoles?.includes(role.id),
  };
}

function assertCanManageCustomRoles(context: ApiReqContext) {
  if (!context.hasPremiumFeature("custom-roles")) {
    context.throwPlanDoesNotAllowError(
      "Must have an Enterprise License Key to use custom roles.",
    );
  }
  if (!context.permissions.canManageCustomRoles()) {
    context.permissions.throwPermissionError();
  }
}

function findRole(context: ApiReqContext, id: string) {
  const role = getRoles(context.org).find((r) => r.id === id);
  if (!role) context.throwNotFoundError(`Role not found: ${id}`);
  return role;
}

async function auditRoles(
  req: Pick<ApiRequestLocals, "audit" | "context">,
  after: Pick<OrganizationInterface, "customRoles" | "deactivatedRoles">,
) {
  const { org } = req.context;
  await req.audit({
    event: "organization.update",
    entity: { object: "organization", id: org.id },
    details: auditDetailsUpdate(
      { customRoles: org.customRoles, deactivatedRoles: org.deactivatedRoles },
      after,
    ),
  });
}

export const listRoles = createApiRequestHandler(listRolesValidator)(
  async (req) => ({
    roles: getRoles(req.context.org).map((r) => toApiRole(r, req.context.org)),
  }),
);

export const postRole = createApiRequestHandler(postRoleValidator)(async (
  req,
) => {
  assertCanManageCustomRoles(req.context);
  const role: Role = req.body;
  await addCustomRole(req.context.org, role);
  await auditRoles(req, {
    customRoles: [...(req.context.org.customRoles ?? []), role],
  });
  return { role: toApiRole(role, req.context.org) };
});

export const putRole = createApiRequestHandler(putRoleValidator)(async (
  req,
) => {
  assertCanManageCustomRoles(req.context);
  const existing = findRole(req.context, req.params.id);
  if (RESERVED_ROLE_IDS.includes(existing.id)) {
    req.context.throwBadRequestError("Built-in roles can't be edited.");
  }
  const { id, ...rest } = { ...existing, ...req.body };
  await editCustomRole(req.context.org, id, rest);
  const updated = { id, ...rest };
  await auditRoles(req, {
    customRoles: (req.context.org.customRoles ?? []).map((r) =>
      r.id === id ? updated : r,
    ),
  });
  return { role: toApiRole(updated, req.context.org) };
});

export const deleteRole = createApiRequestHandler(deleteRoleValidator)(async (
  req,
) => {
  assertCanManageCustomRoles(req.context);
  const { id } = req.params;
  await removeCustomRole(req.context, id);
  await auditRoles(req, {
    customRoles: (req.context.org.customRoles ?? []).filter((r) => r.id !== id),
    deactivatedRoles: (req.context.org.deactivatedRoles ?? []).filter(
      (r) => r !== id,
    ),
  });
  return { deletedId: id };
});

export const postRoleActivate = createApiRequestHandler(
  postRoleActivateValidator,
)(async (req) => {
  assertCanManageCustomRoles(req.context);
  const role = findRole(req.context, req.params.id);
  await activateRoleById(req.context.org, role.id);
  const deactivatedRoles = (req.context.org.deactivatedRoles ?? []).filter(
    (r) => r !== role.id,
  );
  await auditRoles(req, { deactivatedRoles });
  return { role: toApiRole(role, { deactivatedRoles }) };
});

export const postRoleDeactivate = createApiRequestHandler(
  postRoleDeactivateValidator,
)(async (req) => {
  assertCanManageCustomRoles(req.context);
  const role = findRole(req.context, req.params.id);
  await deactivateRoleById(req.context.org, role.id);
  const deactivatedRoles = [
    ...new Set([...(req.context.org.deactivatedRoles ?? []), role.id]),
  ];
  await auditRoles(req, { deactivatedRoles });
  return { role: toApiRole(role, { deactivatedRoles }) };
});
