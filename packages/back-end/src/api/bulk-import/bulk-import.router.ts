import { Router } from "express";
import { postBulkImport } from "./postBulkImport";

const router = Router();

// Dimension Endpoints
// Mounted at /api/v1/bulk-import
router.post("/", postBulkImport);

export default router;
