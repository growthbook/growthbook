import { Router } from "express";
import { getSegment } from "./getSegment.js";
import { listSegments } from "./listSegments.js";
import { deleteSegment } from "./deleteSegment.js";
import { postSegment } from "./postSegment.js";
import { updateSegment } from "./updateSegment.js";

const router = Router();

// Segment Endpoints
// Mounted at /api/v1/segments
router.get("/", listSegments);
router.get("/:id", getSegment);
router.post("/", postSegment);
router.post("/:id", updateSegment);
router.delete("/:id", deleteSegment);

export default router;
