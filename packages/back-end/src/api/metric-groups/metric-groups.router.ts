import { Router } from "express";
import { getMetricGroup } from "./getMetricGroup";
import { listMetricGroups } from "./listMetricGroups";
import { postMetricGroup } from "./postMetricGroup";
import { updateMetricGroup } from "./updateMetricGroup";
import { deleteMetricGroup } from "./deleteMetricGroup";

const router = Router();

// MetricGroup Endpoints
// Mounted at /api/v1/metric-groups
router.get("/", listMetricGroups);
router.post("/", postMetricGroup);
router.get("/:id", getMetricGroup);
router.post("/:id", updateMetricGroup);
router.delete("/:id", deleteMetricGroup);

export default router;
