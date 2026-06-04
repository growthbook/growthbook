import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawContextualBanditController from "./contextual-bandit.controller";

const router = express.Router();

const contextualBanditController = wrapController(
  rawContextualBanditController,
);

// Mounted at app root to preserve the existing /experiment/:id/... namespace.
router.get(
  "/experiment/:id/contextual-bandit/results",
  contextualBanditController.getContextualBanditResults,
);
router.post(
  "/experiment/:id/contextual-bandit/refresh",
  contextualBanditController.postContextualBanditRefresh,
);

export { router as contextualBanditRouter };
