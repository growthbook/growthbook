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

const constantController = wrapController(rawConstantController);

const idParams = z.object({ id: z.string() }).strict();

router.get("/", constantController.getConstants);

// MUST precede the `/:id` route below so the literal isn't captured as an id.
router.get("/draft-states", constantController.getConstantDraftStates);

router.get(
  "/:id",
  validateRequestMiddleware({ params: idParams }),
  constantController.getConstantById,
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

export { router as constantsRouter };
