import { PostArchetypeResponse } from "shared/types/openapi";
import { postArchetypeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import {
  createArchetype,
  toArchetypeApiInterface,
} from "back-end/src/models/ArchetypeModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { validatePayload } from "./validations";

export const postArchetype = createApiRequestHandler(postArchetypeValidator)(
  async (req): Promise<PostArchetypeResponse> => {
    const payload = await validatePayload(req.context, req.body);
    const archetype = await createArchetype(payload);

    await req.audit({
      event: "archetype.created",
      entity: {
        object: "archetype",
        id: archetype.id,
      },
      details: auditDetailsCreate(archetype),
    });
    return {
      archetype: toArchetypeApiInterface(archetype),
    };
  },
);
