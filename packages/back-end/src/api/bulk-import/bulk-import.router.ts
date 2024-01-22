import { Router } from "express";
import { postBulkImport } from "./postBulkImport";

const router = Router();

// Dimension Endpoints
// Mounted at /api/v1/dimensions
router.post("/", postBulkImport);

export default router;
