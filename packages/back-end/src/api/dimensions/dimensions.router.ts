import { Router } from "express";
import { getDimension } from "./getDimension.js";
import { postDimension } from "./postDimension.js";
import { listDimensions } from "./listDimensions.js";
import { updateDimension } from "./updateDimension.js";
import { deleteDimension } from "./deleteDimension.js";

const router = Router();

// Dimension Endpoints
// Mounted at /api/v1/dimensions
router.get("/", listDimensions);
router.post("/", postDimension);
router.get("/:id", getDimension);
router.post("/:id", updateDimension);
router.delete("/:id", deleteDimension);

export default router;
