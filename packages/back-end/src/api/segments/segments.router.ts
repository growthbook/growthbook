import { Router } from "express";
import { getSegment } from "./getSegment";
import { listSegments } from "./listSegments";
import { deleteSegment } from "./deleteSegment";
import { postSegment } from "./postSegment";
import { updateSegment } from "./updateSegment";

const router = Router();

// Segment Endpoints
// Mounted at /api/v1/segments
router.get("/", listSegments);
router.get("/:id", getSegment);
router.post("/", postSegment);
router.post("/:id", updateSegment);
router.delete("/:id", deleteSegment);

export default router;
