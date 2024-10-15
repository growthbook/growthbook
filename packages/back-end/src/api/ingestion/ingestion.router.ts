import { Router } from "express";
import { getDataEnrichment } from "./getDataEnrichment";

const router = Router();

// Mounted at /api/v1/ingestion
router.get("/data-enrichment", getDataEnrichment);

export default router;
