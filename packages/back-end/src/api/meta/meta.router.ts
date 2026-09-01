import { OpenApiRoute } from "back-end/src/util/handler";
import { getVersion } from "./getVersion";

export const metaRoutes: OpenApiRoute[] = [getVersion];
