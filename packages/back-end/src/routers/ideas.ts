import express from "express";
import * as ideasController from "../controllers/ideas";
import { wrapController } from "../services/routers";

wrapController(ideasController);

const router = express.Router();

router.get("/ideas", ideasController.getIdeas);
router.post("/ideas", ideasController.postIdeas);
router.get("/idea/:id", ideasController.getIdea);
router.post("/idea/:id", ideasController.postIdea);
router.delete("/idea/:id", ideasController.deleteIdea);
router.post("/idea/:id/vote", ideasController.postVote);
router.post("/ideas/impact", ideasController.getEstimatedImpact);
router.post(
  "/ideas/estimate/manual",
  ideasController.postEstimatedImpactManual
);
router.get("/ideas/recent/:num", ideasController.getRecentIdeas);

export { router as ideasRouter };
