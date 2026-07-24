import express from "express";
import { z } from "zod";
import {
  postConfigBodyValidator,
  putConfigBodyValidator,
  scopedOverrideValidator,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawConfigController from "./config.controller";

const router = express.Router();
// Sibling path (`/configs-draft-states`) so it can't collide with `/configs/:key`.
const draftStatesRouter = express.Router();

const configController = wrapController(rawConfigController);

const idParams = z.object({ id: z.string() }).strict();
const keyParams = z.object({ key: z.string() }).strict();

router.get("/", configController.getConfigs);

draftStatesRouter.get("/", configController.getConfigDraftStates);

router.get(
  "/:key/resolved",
  validateRequestMiddleware({ params: keyParams }),
  configController.getConfigResolved,
);

router.get(
  "/:id/cyclic-keys",
  validateRequestMiddleware({ params: idParams }),
  configController.getConfigCyclicKeys,
);

router.get(
  "/:id/references",
  validateRequestMiddleware({ params: idParams }),
  configController.getConfigReferences,
);

router.get(
  "/:id/family-references",
  validateRequestMiddleware({ params: idParams }),
  configController.getConfigFamilyReferences,
);

router.get(
  "/:id/key-usage",
  validateRequestMiddleware({ params: idParams }),
  configController.getConfigKeyUsage,
);

router.post(
  "/",
  validateRequestMiddleware({ body: postConfigBodyValidator }),
  configController.postConfig,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: idParams,
    body: putConfigBodyValidator,
  }),
  configController.putConfig,
);

router.post(
  "/:id/lock",
  validateRequestMiddleware({
    params: idParams,
    body: z.object({ reason: z.string().optional() }).strict(),
  }),
  configController.lockConfig,
);

router.post(
  "/:id/unlock",
  validateRequestMiddleware({ params: idParams }),
  configController.unlockConfig,
);

router.post(
  "/:id/experiment-guard",
  validateRequestMiddleware({
    params: idParams,
    body: z.object({ enabled: z.boolean() }).strict(),
  }),
  configController.setConfigExperimentGuard,
);

// Structural env/project variant selection — written immediately, not through
// the revision flow (see setConfigScopedOverrides).
router.put(
  "/:id/scoped-overrides",
  validateRequestMiddleware({
    params: idParams,
    body: z
      .object({ scopedOverrides: z.array(scopedOverrideValidator) })
      .strict(),
  }),
  configController.setConfigScopedOverrides,
);

router.delete(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  configController.deleteConfig,
);

export {
  router as configsRouter,
  draftStatesRouter as configDraftStatesRouter,
};
