import { postArchetypeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { buildOwnerEmailMap } from "back-end/src/services/ownerEmail";
import {
  createArchetype,
  toArchetypeApiInterface,
} from "back-end/src/models/ArchetypeModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { validatePayload } from "./validations";

export const postArchetype = createApiRequestHandler(postArchetypeValidator)(
  async (req) => {
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
    const ownerEmailMap = await buildOwnerEmailMap([archetype.owner]);
    return {
      archetype: toArchetypeApiInterface(archetype, ownerEmailMap),
    };
  },
);
