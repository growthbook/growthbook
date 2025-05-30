import { GetArchetypeResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { getArchetypeValidator } from "back-end/src/validators/openapi";
import {
  getArchetypeById,
  toArchetypeApiInterface,
} from "back-end/src/models/ArchetypeModel";

export const getArchetype = createApiRequestHandler(getArchetypeValidator)(
  async (req): Promise<GetArchetypeResponse> => {
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

    return {
      archetype: toArchetypeApiInterface(archetype),
    };
  }
);
