import express from "express";
import z from "zod";
import { validateRequestMiddleware } from "@back-end/src/routers/utils/validateRequestMiddleware";
import { wrapController } from "@back-end/src/routers/wrapController";
import {
  createUrlRedirectValidator,
  updateUrlRedirectValidator,
} from "./url-redirects.validators";
import * as rawController from "./url-redirects.controller";

const router = express.Router();

const urlRedirectController = wrapController(rawController);

const idParamValidator = z.object({ id: z.string() }).strict();

router.post(
  "/",
  validateRequestMiddleware({
    body: createUrlRedirectValidator,
  }),
  urlRedirectController.postURLRedirect
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: idParamValidator,
    body: updateUrlRedirectValidator,
  }),
  urlRedirectController.putURLRedirect
);

router.delete(
  "/:id",
  validateRequestMiddleware({
    params: idParamValidator,
  }),
  urlRedirectController.deleteURLRedirect
);

export { router as urlRedirectRouter };
