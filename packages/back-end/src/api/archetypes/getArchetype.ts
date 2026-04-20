import { getArchetypeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { buildOwnerEmailMap } from "back-end/src/services/ownerEmail";
import {
  getArchetypeById,
  toArchetypeApiInterface,
} from "back-end/src/models/ArchetypeModel";

export const getArchetype = createApiRequestHandler(getArchetypeValidator)(
  async (req) => {
    const { id } = req.params;
    const orgId = req.organization.id;
    const archetype = await getArchetypeById(id, orgId);
    if (!archetype) {
      throw new Error(`An archetype with id ${id} does not exist`);
    }

    if (
      !req.context.permissions.canReadMultiProjectResource(archetype.projects)
    )
      req.context.permissions.throwPermissionError();

    const ownerEmailMap = await buildOwnerEmailMap([archetype.owner]);
    return {
      archetype: toArchetypeApiInterface(archetype, ownerEmailMap),
    };
  },
);
