import { OpenApiRoute } from "back-end/src/util/handler";
import { listAttributes } from "./listAttributes";
import { putAttribute } from "./putAttribute";
import { postAttribute } from "./postAttribute";
import { deleteAttribute } from "./deleteAttribute";

export const attributesRoutes: OpenApiRoute[] = [
  listAttributes,
  postAttribute,
  putAttribute,
  deleteAttribute,
];
