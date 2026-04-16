import { OpenApiRoute } from "back-end/src/util/handler";
import { postCopyTransform } from "./postCopyTransform";

export const openaiRoutes: OpenApiRoute[] = [postCopyTransform];
