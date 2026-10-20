import { OpenApiRoute } from "back-end/src/util/handler";
import { postReleasePublishRevisions } from "./postReleasePublishRevisions";

export const releasesRoutes: OpenApiRoute[] = [postReleasePublishRevisions];
