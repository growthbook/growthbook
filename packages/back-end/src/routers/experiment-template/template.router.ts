import express from "express";
import { z } from "zod";
import {
  createTemplateValidator,
  updateTemplateValidator,
} from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawTemplateController from "./template.controller";

const router = express.Router();

const templateController = wrapController(rawTemplateController);

const templateParams = z.object({ id: z.string() }).strict();

router.get("/", templateController.getTemplates);

router.post(
  "/",
  validateRequestMiddleware({
    body: createTemplateValidator,
  }),
  templateController.postTemplate,
);

router.delete(
  "/:id",
  validateRequestMiddleware({
    params: templateParams,
  }),
  templateController.deleteTemplate,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: templateParams,
    body: updateTemplateValidator,
  }),
  templateController.putTemplate,
);

export { router as templateRouter };
