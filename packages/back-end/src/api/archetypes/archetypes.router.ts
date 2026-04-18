import { OpenApiRoute } from "back-end/src/util/handler";
import { listArchetypes } from "./listArchetypes";
import { postArchetype } from "./postArchetype";
import { getArchetype } from "./getArchetype";
import { putArchetype } from "./putArchetype";
import { deleteArchetype } from "./deleteArchetype";

export const archetypesRoutes: OpenApiRoute[] = [
  listArchetypes,
  postArchetype,
  getArchetype,
  putArchetype,
  deleteArchetype,
];
