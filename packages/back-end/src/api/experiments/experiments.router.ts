import { OpenApiRoute } from "back-end/src/util/handler";
import { postVisualChangesets } from "back-end/src/api/visual-changesets/postVisualChangesets";
import { listVisualChangesets } from "back-end/src/api/visual-changesets/listVisualChangesets";
import { getExperimentResults } from "./getExperimentResults";
import { getExperiment } from "./getExperiment";
import { listExperiments } from "./listExperiments";
import { updateExperiment } from "./updateExperiment";
import { postExperiment } from "./postExperiment";
import { postExperimentSnapshot } from "./postExperimentSnapshot";
import { postVariationImageUpload } from "./postVariationImageUpload";
import { deleteVariationScreenshot } from "./deleteVariationScreenshot";
import { getExperimentNames } from "./getExperimentNames";

export const experimentsRoutes: OpenApiRoute[] = [
  // Experiment Endpoints
  listExperiments,
  postExperiment,
  getExperiment,
  getExperimentResults,
  updateExperiment,
  postExperimentSnapshot,
  postVariationImageUpload,
  deleteVariationScreenshot,
  getExperimentNames,
  // VisualChangeset Endpoints (mounted under /experiments)
  listVisualChangesets,
  postVisualChangesets,
];
