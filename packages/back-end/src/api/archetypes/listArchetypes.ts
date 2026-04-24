import { listArchetypesValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmails } from "back-end/src/services/owner";
import {
  getAllArchetypes,
  toArchetypeApiInterface,
} from "back-end/src/models/ArchetypeModel";

export const listArchetypes = createApiRequestHandler(listArchetypesValidator)(
  async (req) => {
    const archetypes = await getAllArchetypes(
      req.context.org.id,
      req.context.userId,
    );
    const filteredArchetypes = archetypes.filter((archetype) =>
      req.context.permissions.canReadMultiProjectResource(archetype.projects),
    );

    return {
      archetypes: await resolveOwnerEmails(
        filteredArchetypes.map((archetype) =>
          toArchetypeApiInterface(archetype),
        ),
        req.context,
      ),
    };
  },
);
