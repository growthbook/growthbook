import { OpenApiRoute } from "back-end/src/util/handler";
import { getDimension } from "./getDimension";
import { postDimension } from "./postDimension";
import { listDimensions } from "./listDimensions";
import { updateDimension } from "./updateDimension";
import { deleteDimension } from "./deleteDimension";

export const dimensionsRoutes: OpenApiRoute[] = [
  listDimensions,
  postDimension,
  getDimension,
  updateDimension,
  deleteDimension,
];
