import { OpenApiRoute } from "back-end/src/util/handler";
import { getConfirmation } from "./getConfirmation";
import { listConfirmations } from "./listConfirmations";

export const confirmationsRoutes: OpenApiRoute[] = [
  listConfirmations,
  getConfirmation,
];
