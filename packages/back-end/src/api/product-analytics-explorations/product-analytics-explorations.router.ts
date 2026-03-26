import { Router } from "express";
import { postMetricExploration } from "./postMetricExploration";
import { postFactTableExploration } from "./postFactTableExploration";
import { postDataSourceExploration } from "./postDataSourceExploration";

const router = Router();

// Product Analytics Exploration Endpoints
// Mounted at /api/v1/product-analytics
router.post("/metric-exploration", postMetricExploration);
router.post("/fact-table-exploration", postFactTableExploration);
router.post("/data-source-exploration", postDataSourceExploration);

export default router;
