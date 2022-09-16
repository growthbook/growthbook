import express from "express";
import {
  deletePresentation,
  getPresentation,
  getPresentationPreview,
  getPresentations,
  postPresentation,
  updatePresentation,
} from "../controllers/presentations";

const router = express.Router();

router.get("/presentations", getPresentations);
router.post("/presentation", postPresentation);
router.get("/presentation/preview", getPresentationPreview);
router.get("/presentation/:id", getPresentation);
router.post("/presentation/:id", updatePresentation);
router.delete("/presentation/:id", deletePresentation);

export { router as presentationsRouter };
