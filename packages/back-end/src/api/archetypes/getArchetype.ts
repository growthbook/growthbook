import { getArchetypeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import { NotFoundError } from "back-end/src/util/errors";
import {
  getArchetypeById,
  isArchetypeVisibleTo,
  toArchetypeApiInterface,
} from "back-end/src/models/ArchetypeModel";

export const getArchetype = createApiRequestHandler(getArchetypeValidator)(
  async (req) => {
    if (!req.context.hasPremiumFeature("archetypes")) {
      req.context.throwPlanDoesNotAllowError(
        "Archetypes require a premium plan.",
      );
    }

    const { id } = req.params;
    const orgId = req.organization.id;
    const archetype = await getArchetypeById(id, orgId);
    if (
      !archetype ||
      !isArchetypeVisibleTo(archetype, req.context.userId) ||
      !req.context.permissions.canReadMultiProjectResource(archetype.projects)
    ) {
      throw new NotFoundError(`An archetype with id ${id} does not exist`);
    }

    return {
      archetype: await resolveOwnerEmail(
        toArchetypeApiInterface(archetype),
        req.context,
      ),
    };
  },
);
