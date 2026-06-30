import { postArchetypeValidator } from "shared/validators";
import { createApiRequestHandler } from "back-end/src/util/handler";
import { resolveOwnerEmail } from "back-end/src/services/owner";
import {
  createArchetype,
  toArchetypeApiInterface,
} from "back-end/src/models/ArchetypeModel";
import { auditDetailsCreate } from "back-end/src/services/audit";
import { validatePayload } from "./validations";

export const postArchetype = createApiRequestHandler(postArchetypeValidator)(
  async (req) => {
    if (!req.context.hasPremiumFeature("archetypes")) {
      req.context.throwPlanDoesNotAllowError(
        "Archetypes require a premium plan.",
      );
    }

    const payload = await validatePayload(req.context, req.body);

    if (!req.context.permissions.canCreateArchetype(payload))
      req.context.permissions.throwPermissionError();

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
      archetype: await resolveOwnerEmail(
        toArchetypeApiInterface(archetype),
        req.context,
      ),
    };
  },
);
