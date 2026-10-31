import express from "express";
import { pageLoadValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawPageLoadController from "./page-load.controller";

const router = express.Router();

const PageLoadController = wrapController(rawPageLoadController);

router.post(
  "/",
  validateRequestMiddleware({ body: pageLoadValidator }),
  PageLoadController.postPageLoad,
);

export { router as pageLoadRouter };
