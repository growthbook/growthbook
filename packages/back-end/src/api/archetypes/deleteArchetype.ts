import { DeleteArchetypeResponse } from "shared/types/openapi";
import { deleteArchetypeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  deleteArchetypeById,
  getArchetypeById,
} from "back-end/src/models/ArchetypeModel";
import { auditDetailsDelete } from "back-end/src/services/audit";

export const deleteArchetype = createApiRequestHandler(
  deleteArchetypeValidator,
)(async (req): Promise<DeleteArchetypeResponse> => {
  const { id } = req.params;
  const orgId = req.organization.id;
  const archetype = await getArchetypeById(id, orgId);
  if (!archetype) {
    throw new Error(`An archetype with id ${id} does not exist`);
  }

  if (!req.context.permissions.canDeleteArchetype(archetype))
    req.context.permissions.throwPermissionError();

  await deleteArchetypeById(id, orgId);
  await req.audit({
    event: "archetype.deleted",
    entity: {
      object: "archetype",
      id: archetype.id,
    },
    details: auditDetailsDelete(archetype),
  });

  return {
    deletedId: archetype.id,
  };
});
