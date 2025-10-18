import { Router } from "express";
import { getCustomFields } from "./getCustomFields";

const router = Router();

// Custom Fields Endpoints
// Mounted at /api/v1/custom-fields
router.get("/", getCustomFields);

export default router;
