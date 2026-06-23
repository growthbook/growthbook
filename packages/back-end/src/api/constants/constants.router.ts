import { OpenApiRoute } from "back-end/src/util/handler";
import { listConstants } from "./listConstants";
import { postConstant } from "./postConstant";
import { getConstant } from "./getConstant";
import { updateConstant } from "./updateConstant";
import { archiveConstant, unarchiveConstant } from "./archiveConstant";
import { deleteConstant } from "./deleteConstant";
import { getConstantReferences } from "./getConstantReferences";

export const constantsRoutes: OpenApiRoute[] = [
  listConstants,
  postConstant,
  getConstantReferences,
  getConstant,
  updateConstant,
  archiveConstant,
  unarchiveConstant,
  deleteConstant,
];
