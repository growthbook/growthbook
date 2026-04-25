import { putArchetypeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import {
  getArchetypeById,
  toArchetypeApiInterface,
  updateArchetypeById,
} from "back-end/src/models/ArchetypeModel";
import { auditDetailsUpdate } from "back-end/src/services/audit";
import { validatePayload } from "./validations";

export const putArchetype = createApiRequestHandler(putArchetypeValidator)(
  async (req) => {
    const { id } = req.params;
    const orgId = req.organization.id;
    const archetype = await getArchetypeById(id, orgId);
    if (!archetype) {
      throw new Error(`An archetype with id ${id} does not exist`);
    }

    const rawUpdatedArchetype = { ...archetype, ...req.body };

    const updatedArchetype = {
      ...rawUpdatedArchetype,
      ...(await validatePayload(req.context, rawUpdatedArchetype)),
    };
    if (
      !req.context.permissions.canUpdateArchetype(archetype, updatedArchetype)
    )
      req.context.permissions.throwPermissionError();

    await updateArchetypeById(id, orgId, updatedArchetype);
    await req.audit({
      event: "archetype.updated",
      entity: {
        object: "archetype",
        id: archetype.id,
      },
      details: auditDetailsUpdate(archetype, updatedArchetype),
    });

    return {
      archetype: await resolveOwnerEmail(
        toArchetypeApiInterface(updatedArchetype),
        req.context,
      ),
    };
  },
);
