import { Router } from "express";
import { getDimension } from "./getDimension";
import { listDimensions } from "./listDimensions";

const router = Router();

// Dimension Endpoints
// Mounted at /api/v1/dimensions
router.get("/", listDimensions);
router.get("/:id", getDimension);

export default router;
