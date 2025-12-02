import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawCustomFieldController from "./custom-fields.controller";
import {
  createCustomFieldsValidator,
  redorderFieldsValidator,
  updateCustomFieldsValidator,
} from "./custom-fields.validators";

const router = express.Router();

const customFieldController = wrapController(rawCustomFieldController);

router.post(
  "/",
  validateRequestMiddleware({
    body: createCustomFieldsValidator,
  }),
  customFieldController.postCustomField,
);

router.post(
  "/reorder",
  validateRequestMiddleware({
    body: redorderFieldsValidator,
  }),
  customFieldController.postReorderCustomFields,
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: updateCustomFieldsValidator,
  }),
  customFieldController.putCustomField,
);

router.delete(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  customFieldController.deleteCustomField,
);

export { router as customFieldsRouter };
