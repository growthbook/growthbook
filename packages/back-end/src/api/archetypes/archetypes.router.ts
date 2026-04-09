import { createOpenApiRouter } from "back-end/src/util/handler";
import { listArchetypes } from "./listArchetypes";
import { postArchetype } from "./postArchetype";
import { getArchetype } from "./getArchetype";
import { putArchetype } from "./putArchetype";
import { deleteArchetype } from "./deleteArchetype";

const router = createOpenApiRouter("/archetypes", [
  ["get", "/", listArchetypes],
  ["post", "/", postArchetype],
  ["get", "/:id", getArchetype],
  ["put", "/:id", putArchetype],
  ["delete", "/:id", deleteArchetype],
]);

export default router;
