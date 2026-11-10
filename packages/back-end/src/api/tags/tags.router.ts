import { OpenApiRoute } from "back-end/src/util/handler";
import { listTags } from "./listTags";
import { postTag } from "./postTag";

export const tagsRoutes: OpenApiRoute[] = [listTags, postTag];
