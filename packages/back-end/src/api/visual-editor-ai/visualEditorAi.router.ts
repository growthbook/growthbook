import { OpenApiRoute } from "back-end/src/util/handler";
import { postAIEdit } from "./postAIEdit";
import { postAIEditResume } from "./postAIEditResume";
import { postAISuggestions } from "./postAISuggestions";
import { postAIImageGen } from "./postAIImageGen";
import { postPromoteImage } from "./postPromoteImage";
import { postUploadSignedUrl } from "./postUploadSignedUrl";
import { postAddVariant } from "./postAddVariant";
import { postCreateExperiment } from "./postCreateExperiment";
import { postCreateChangeset } from "./postCreateChangeset";
import { postRenameExperiment } from "./postRenameExperiment";
import { getBootstrap } from "./getBootstrap";
import { getLibraryImages } from "./getLibraryImages";
import { postFigmaToVariant } from "./postFigmaToVariant";
import { postFigmaOAuthExchange } from "./postFigmaOAuthExchange";
import { getFigmaStatus } from "./getFigmaStatus";
import { postFigmaDisconnect } from "./postFigmaDisconnect";

export const visualEditorAiRoutes: OpenApiRoute[] = [
  postAIEdit,
  postAIEditResume,
  postAISuggestions,
  postAIImageGen,
  postPromoteImage,
  postUploadSignedUrl,
  postAddVariant,
  postCreateExperiment,
  postCreateChangeset,
  postRenameExperiment,
  getBootstrap,
  getLibraryImages,
  postFigmaToVariant,
  postFigmaOAuthExchange,
  getFigmaStatus,
  postFigmaDisconnect,
];
