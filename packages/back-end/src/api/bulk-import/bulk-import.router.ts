import { Router } from "express";
import { postBulkImportFacts } from "./postBulkImportFacts.js";

const router = Router();

// Dimension Endpoints
// Mounted at /api/v1/bulk-import
router.post("/facts", postBulkImportFacts);

export default router;
