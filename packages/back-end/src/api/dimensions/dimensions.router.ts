import { Router } from "express";
import { getDimension } from "./getDimension";
import { postDimension } from "./postDimension";
import { listDimensions } from "./listDimensions";
import { updateDimension } from "./updateDimension";
import { deleteDimension } from "./deleteDimension";

const router = Router();

// Dimension Endpoints
// Mounted at /api/v1/dimensions
router.get("/", listDimensions);
router.post("/", postDimension);
router.get("/:id", getDimension);
router.post("/:id", updateDimension);
router.delete("/:id", deleteDimension);

export default router;
