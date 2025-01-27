import { ListArchetypesResponse } from "back-end/types/openapi";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { listArchetypesValidator } from "back-end/src/validators/openapi";
import {
  getAllArchetypes,
  toArchetypeApiInterface,
} from "back-end/src/models/ArchetypeModel";

export const listArchetypes = createApiRequestHandler(listArchetypesValidator)(
  async (req): Promise<ListArchetypesResponse> => {
    const archetypes = await getAllArchetypes(
      req.context.org.id,
      req.context.userId
    );
    return {
      archetypes: archetypes.map((archetype) =>
        toArchetypeApiInterface(archetype)
      ),
    };
  }
);
