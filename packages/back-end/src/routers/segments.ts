import express from "express";
import * as segmentsController from "../controllers/segments";
import { wrapController } from "../services/routers";

wrapController(segmentsController);

const router = express.Router();

router.get("", segmentsController.getAllSegments);
router.post("", segmentsController.postSegments);
router.put("/:id", segmentsController.putSegment);
router.delete("/:id", segmentsController.deleteSegment);
router.get("/:id/usage", segmentsController.getSegmentUsage);

export { router as segmentsRouter };
