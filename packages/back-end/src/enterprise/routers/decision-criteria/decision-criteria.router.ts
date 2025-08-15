import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawDecisionCriteriaController from "./decision-criteria.controller";

const router = express.Router();

const decisionCriteriaController = wrapController(
  rawDecisionCriteriaController,
);

// GET /decision-criteria
// Get all decision criteria
router.get("/", decisionCriteriaController.getDecisionCriteria);

// GET /decision-criteria/:id
// Get a specific decision criteria by ID
router.get("/:id", decisionCriteriaController.getDecisionCriteriaById);

// POST /decision-criteria
// Create a new decision criteria
router.post("/", decisionCriteriaController.postDecisionCriteria);

// DELETE /decision-criteria/:id
// Delete a decision criteria
router.delete("/:id", decisionCriteriaController.deleteDecisionCriteria);

// PUT /decision-criteria/:id
// Update a decision criteria
router.put("/:id", decisionCriteriaController.putDecisionCriteria);

export default router;
