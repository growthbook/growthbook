import express from "express";
import { z } from "zod";
import {
  postConstantBodyValidator,
  putConstantBodyValidator,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawConstantController from "./constant.controller";

const router = express.Router();
// `draft-states` is a collection-level helper. It's mounted at its own sibling
// path (`/constants-draft-states`) rather than under `/constants/...` so it can
// never collide with the `/constants/:key` lookup (a constant keyed literally
// "draft-states" would otherwise be unreachable).
const draftStatesRouter = express.Router();

const constantController = wrapController(rawConstantController);

const idParams = z.object({ id: z.string() }).strict();
const keyParams = z.object({ key: z.string() }).strict();

router.get("/", constantController.getConstants);

draftStatesRouter.get("/", constantController.getConstantDraftStates);

// Single-constant fetch is by `key` (drives the detail-page URL). The `/:id`
// routes below operate on the internal id the client holds after this fetch.
router.get(
  "/:key",
  validateRequestMiddleware({ params: keyParams }),
  constantController.getConstantByKey,
);

router.get(
  "/:id/cyclic-keys",
  validateRequestMiddleware({ params: idParams }),
  constantController.getConstantCyclicKeys,
);

router.get(
  "/:id/references",
  validateRequestMiddleware({ params: idParams }),
  constantController.getConstantReferences,
);

router.post(
  "/",
  validateRequestMiddleware({ body: postConstantBodyValidator }),
  constantController.postConstant,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: idParams,
    body: putConstantBodyValidator,
  }),
  constantController.putConstant,
);

router.delete(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  constantController.deleteConstant,
);

export {
  router as constantsRouter,
  draftStatesRouter as constantDraftStatesRouter,
};
