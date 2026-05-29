import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawContextualBanditController from "./contextual-bandit.controller";

const router = express.Router();

const contextualBanditController = wrapController(
  rawContextualBanditController,
);

// Internal UI endpoints mounted at the app root so the existing
// /experiment/:id/... namespace is preserved.
router.get(
  "/experiment/:id/contextual-bandit/results",
  contextualBanditController.getContextualBanditResults,
);
router.post(
  "/experiment/:id/contextual-bandit/refresh",
  contextualBanditController.postContextualBanditRefresh,
);

export { router as contextualBanditRouter };
