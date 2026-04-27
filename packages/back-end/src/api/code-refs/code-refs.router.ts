import { OpenApiRoute } from "back-end/src/util/handler";
import { postCodeRefs } from "./postCodeRefs";
import { getCodeRefs } from "./getCodeRefs";
import { listCodeRefs } from "./listCodeRefs";

export const codeRefsRoutes: OpenApiRoute[] = [
  postCodeRefs,
  listCodeRefs,
  getCodeRefs,
];
