import { OpenApiRoute } from "back-end/src/util/handler";
import { getVisualChangeset } from "./getVisualChangeset";
import { postVisualChange } from "./postVisualChange";
import { putVisualChange } from "./putVisualChange";
import { putVisualChangeset } from "./putVisualChangeset";
import { deleteVisualChangeset } from "./deleteVisualChangeset";

export const visualChangesetsRoutes: OpenApiRoute[] = [
  getVisualChangeset,
  putVisualChangeset,
  postVisualChange,
  putVisualChange,
  deleteVisualChangeset,
];
