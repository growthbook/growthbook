import { Router } from "express";
import { listVisualChangesets } from "back-end/src/api/visual-changesets/listVisualChangesets";
import { postExperimentVisualChangeset } from "./postExperimentVisualChangeset";
import { getExperimentResults } from "./getExperimentResults";
import { getExperiment } from "./getExperiment";
import { listExperiments } from "./listExperiments";
import { updateExperiment } from "./updateExperiment";
import { postExperiment } from "./postExperiment";
import { postExperimentSnapshot } from "./postExperimentSnapshot";
import { postVariationImageUpload } from "./postVariationImageUpload";
import { deleteVariationScreenshot } from "./deleteVariationScreenshot";

const router = Router();

// Experiment Endpoints
// Mounted at /api/v1/experiments
router.get("/", listExperiments);
router.post("/", postExperiment);
router.get("/:id", getExperiment);
router.get("/:id/results", getExperimentResults);
router.post("/:id/snapshot", postExperimentSnapshot);
router.post("/:id/visual-changeset", postExperimentVisualChangeset);
router.post("/:id", updateExperiment);
router.post(
  "/:id/variation/:variationId/screenshot/upload",
  postVariationImageUpload,
);
router.delete(
  "/:id/variation/:variationId/screenshot",
  deleteVariationScreenshot,
);

// VisualChangeset Endpoints
router.get("/:id/visual-changesets", listVisualChangesets);

export default router;
