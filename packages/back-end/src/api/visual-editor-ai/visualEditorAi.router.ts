import { OpenApiRoute } from "back-end/src/util/handler";
import { postAIEdit } from "./postAIEdit";
import { postAISuggestions } from "./postAISuggestions";
import { postAIImageGen } from "./postAIImageGen";
import { postPromoteImage } from "./postPromoteImage";
import { postUploadSignedUrl } from "./postUploadSignedUrl";
import { postAddVariant } from "./postAddVariant";
import { postCreateExperiment } from "./postCreateExperiment";
import { postRenameExperiment } from "./postRenameExperiment";
import { getBootstrap } from "./getBootstrap";

export const visualEditorAiRoutes: OpenApiRoute[] = [
  postAIEdit,
  postAISuggestions,
  postAIImageGen,
  postPromoteImage,
  postUploadSignedUrl,
  postAddVariant,
  postCreateExperiment,
  postRenameExperiment,
  getBootstrap,
];
