import { OpenApiRoute } from "back-end/src/util/handler";
import { getSavedGroup } from "./getSavedGroup";
import { listSavedGroups } from "./listSavedGroups";
import { postSavedGroup } from "./postSavedGroup";
import { updateSavedGroup } from "./updateSavedGroup";
import { deleteSavedGroup } from "./deleteSavedGroup";

export const savedGroupsRoutes: OpenApiRoute[] = [
  listSavedGroups,
  postSavedGroup,
  getSavedGroup,
  updateSavedGroup,
  deleteSavedGroup,
];
