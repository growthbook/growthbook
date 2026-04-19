import { OpenApiRoute } from "back-end/src/util/handler";
import { postBulkImportFacts } from "./postBulkImportFacts";

export const bulkImportRoutes: OpenApiRoute[] = [postBulkImportFacts];
