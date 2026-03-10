import { Router } from "express";
import { listTemplates } from "./listTemplates";

const router = Router();

// Experiment Template Endpoints
// Mounted at /api/v1/templates
router.get("/", listTemplates);

export default router;
