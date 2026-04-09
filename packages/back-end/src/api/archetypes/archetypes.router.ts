import {
  deleteArchetypeValidator,
  getArchetypeValidator,
  listArchetypesValidator,
  postArchetypeValidator,
  putArchetypeValidator,
} from "shared/validators";
import { createOpenApiRouter, defineRoute } from "back-end/src/util/handler";
import {
  createArchetype,
  deleteArchetypeById,
  getAllArchetypes,
  getArchetypeById,
  toArchetypeApiInterface,
  updateArchetypeById,
} from "back-end/src/models/ArchetypeModel";
import {
  auditDetailsCreate,
  auditDetailsDelete,
  auditDetailsUpdate,
} from "back-end/src/services/audit";
import { validatePayload } from "./validations";

export default createOpenApiRouter(
  "/archetypes",
  [
    [
      "get",
      "/",
      defineRoute({
        ...listArchetypesValidator,
        handler: async (req) => {
          const archetypes = await getAllArchetypes(
            req.context.org.id,
            req.context.userId,
          );
          return {
            archetypes: archetypes
              .filter((a) =>
                req.context.permissions.canReadMultiProjectResource(a.projects),
              )
              .map(toArchetypeApiInterface),
          };
        },
      }),
    ],
    [
      "post",
      "/",
      defineRoute({
        ...postArchetypeValidator,
        handler: async (req) => {
          const payload = await validatePayload(req.context, req.body);
          const archetype = await createArchetype(payload);
          await req.audit({
            event: "archetype.created",
            entity: { object: "archetype", id: archetype.id },
            details: auditDetailsCreate(archetype),
          });
          return { archetype: toArchetypeApiInterface(archetype) };
        },
      }),
    ],
    [
      "get",
      "/:id",
      defineRoute({
        ...getArchetypeValidator,
        handler: async (req) => {
          const { id } = req.params;
          const archetype = await getArchetypeById(id, req.context.org.id);
          if (!archetype) {
            throw new Error(`An archetype with id ${id} does not exist`);
          }
          if (
            !req.context.permissions.canReadMultiProjectResource(
              archetype.projects,
            )
          ) {
            req.context.permissions.throwPermissionError();
          }
          return { archetype: toArchetypeApiInterface(archetype) };
        },
      }),
    ],
    [
      "put",
      "/:id",
      defineRoute({
        ...putArchetypeValidator,
        handler: async (req) => {
          const { id } = req.params;
          const archetype = await getArchetypeById(id, req.context.org.id);
          if (!archetype) {
            throw new Error(`An archetype with id ${id} does not exist`);
          }
          const rawUpdated = { ...archetype, ...req.body };
          const updatedArchetype = {
            ...rawUpdated,
            ...(await validatePayload(req.context, rawUpdated)),
          };
          if (
            !req.context.permissions.canUpdateArchetype(
              archetype,
              updatedArchetype,
            )
          ) {
            req.context.permissions.throwPermissionError();
          }
          await updateArchetypeById(id, req.context.org.id, updatedArchetype);
          await req.audit({
            event: "archetype.updated",
            entity: { object: "archetype", id: archetype.id },
            details: auditDetailsUpdate(archetype, updatedArchetype),
          });
          return { archetype: toArchetypeApiInterface(updatedArchetype) };
        },
      }),
    ],
    [
      "delete",
      "/:id",
      defineRoute({
        ...deleteArchetypeValidator,
        handler: async (req) => {
          const { id } = req.params;
          const archetype = await getArchetypeById(id, req.context.org.id);
          if (!archetype) {
            throw new Error(`An archetype with id ${id} does not exist`);
          }
          if (!req.context.permissions.canDeleteArchetype(archetype)) {
            req.context.permissions.throwPermissionError();
          }
          await deleteArchetypeById(id, req.context.org.id);
          await req.audit({
            event: "archetype.deleted",
            entity: { object: "archetype", id: archetype.id },
            details: auditDetailsDelete(archetype),
          });
          return { deletedId: archetype.id };
        },
      }),
    ],
  ],
  {
    name: "archetypes",
    "x-displayName": "Archetypes",
    description:
      "Archetypes allow you to simulate the result of targeting rules on pre-set user attributes",
  },
);
