import { Router } from "express";
import { getVisualChangeset } from "./getVisualChangeset";

const router = Router();

// VisualChangeset Endpoints
// Mounted at /api/v1/visual-changesets
router.get("/:id", getVisualChangeset);

// See experiment router for 'get all' endpoint

export default router;
