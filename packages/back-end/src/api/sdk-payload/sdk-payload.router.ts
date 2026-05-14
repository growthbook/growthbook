import { OpenApiRoute } from "back-end/src/util/handler";
import { getSdkPayload } from "./getSdkPayload";

export const sdkPayloadRoutes: OpenApiRoute[] = [getSdkPayload];
