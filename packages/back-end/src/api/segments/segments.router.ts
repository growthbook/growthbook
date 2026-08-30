import { OpenApiRoute } from "back-end/src/util/handler";
import { getSegment } from "./getSegment";
import { listSegments } from "./listSegments";
import { deleteSegment } from "./deleteSegment";
import { postSegment } from "./postSegment";
import { updateSegment } from "./updateSegment";

export const segmentsRoutes: OpenApiRoute[] = [
  listSegments,
  getSegment,
  postSegment,
  updateSegment,
  deleteSegment,
];
