import { Router } from "express";
import { importStatsigBulk } from "./importBulk";

const router = Router();

// Statsig Import Endpoints
// Mounted at /api/v1/statsig-import
router.post("/bulk", importStatsigBulk);

export default router;
