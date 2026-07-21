import { OpenApiRoute } from "back-end/src/util/handler";
import { postVisualChangesets } from "back-end/src/api/visual-changesets/postVisualChangesets";
import { listVisualChangesets } from "back-end/src/api/visual-changesets/listVisualChangesets";
import { getExperimentResults } from "./getExperimentResults";
import { listExperimentResults } from "./listExperimentResults";
import { getExperiment } from "./getExperiment";
import { listExperiments } from "./listExperiments";
import { updateExperiment } from "./updateExperiment";
import { postExperiment } from "./postExperiment";
import { postExperimentStart } from "./postExperimentStart";
import { postExperimentStartChecklistManualComplete } from "./postExperimentStartChecklist";
import { postExperimentStop } from "./postExperimentStop";
import { putExperimentSchedule } from "./putExperimentSchedule";
import { postExperimentModifyTemporaryRollout } from "./postExperimentModifyTemporaryRollout";
import { postExperimentSnapshot } from "./postExperimentSnapshot";
import { postVariationImageUpload } from "./postVariationImageUpload";
import { deleteVariationScreenshot } from "./deleteVariationScreenshot";
import { getExperimentNames } from "./getExperimentNames";
import { getExperimentStartChecklist } from "./getExperimentStartChecklist";

export const experimentsRoutes: OpenApiRoute[] = [
  // Experiment Endpoints
  listExperiments,
  postExperiment,
  // listExperimentResults must come before getExperimentResults so the literal
  // path `/experiments/results` is not captured by `/experiments/:id/results`.
  listExperimentResults,
  getExperiment,
  getExperimentStartChecklist,
  getExperimentResults,
  updateExperiment,
  postExperimentStart,
  postExperimentStartChecklistManualComplete,
  postExperimentStop,
  putExperimentSchedule,
  postExperimentModifyTemporaryRollout,
  postExperimentSnapshot,
  postVariationImageUpload,
  deleteVariationScreenshot,
  getExperimentNames,
  // VisualChangeset Endpoints (mounted under /experiments)
  listVisualChangesets,
  postVisualChangesets,
];
