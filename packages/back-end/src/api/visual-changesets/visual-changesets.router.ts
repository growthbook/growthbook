import { Router } from "express";
import { getVisualChangeset } from "./getVisualChangeset";
import { listVisualChangesets } from "./listVisualChangesets";

const router = Router();

// VisualChangeset Endpoints
// Mounted at /api/v1/visual-changesets
router.get("/", listVisualChangesets);
router.get("/:id", getVisualChangeset);

export default router;
