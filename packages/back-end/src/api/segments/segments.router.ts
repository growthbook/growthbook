import { Router } from "express";
import { getSegment } from "./getSegment";
import { listSegments } from "./listSegments";

const router = Router();

// Segment Endpoints
// Mounted at /api/v1/segments
router.get("/", listSegments);
router.get("/:id", getSegment);

export default router;
