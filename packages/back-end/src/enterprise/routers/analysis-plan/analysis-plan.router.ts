import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawAnalysisPlanController from "./analysis-plan.controller";

const router = express.Router();

const analysisPlanController = wrapController(rawAnalysisPlanController);

const analysisPlanParams = z.object({ id: z.string() }).strict();

// GET /analysis-plans
// Get all analysis plans
router.get("/", analysisPlanController.getAnalysisPlans);

// GET /analysis-plans/:id
// Get a specific analysis plan by ID
router.get("/:id", analysisPlanController.getAnalysisPlanById);

// POST /analysis-plans
// Create a new analysis plan
router.post("/", analysisPlanController.postAnalysisPlan);

// DELETE /analysis-plans/:id
// Delete an analysis plan
router.delete("/:id", analysisPlanController.deleteAnalysisPlan);

// PUT /analysis-plans/:id
// Update an analysis plan
router.put("/:id", analysisPlanController.putAnalysisPlan);

export default router;
