import { Router } from "express";
import { postMetricExploration } from "./postMetricExploration";
import { postFactTableExploration } from "./postFactTableExploration";
import { postDataSourceExploration } from "./postDataSourceExploration";

const router = Router();

// Product Analytics Exploration Endpoints
// Mounted at /api/v1/product-analytics-explorations
router.post("/metric", postMetricExploration);
router.post("/fact-table", postFactTableExploration);
router.post("/data-source", postDataSourceExploration);

export default router;
