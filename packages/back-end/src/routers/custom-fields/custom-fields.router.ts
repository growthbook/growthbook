import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawCustomFieldController from "./custom-fields.controller";

const router = express.Router();

const customFieldController = wrapController(rawCustomFieldController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      name: z.string(),
      description: z.string(),
      placeholder: z.string(),
      defaultValue: z.any().optional(),
      type: z.any(),
      values: z.string().optional(),
      required: z.boolean(),
      index: z.boolean().optional(),
      projects: z.string().array().optional(),
      section: z.enum(["feature", "experiment"]),
    }),
  }),
  customFieldController.postCustomField
);

router.post(
  "/reorder",
  validateRequestMiddleware({
    body: z.object({
      oldId: z.string(),
      newId: z.string(),
    }),
  }),
  customFieldController.postReorderCustomFields
);

router.put(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
    body: z.object({
      name: z.string(),
      description: z.string(),
      placeholder: z.string(),
      defaultValue: z.any().optional(),
      type: z.any(),
      values: z.string().optional(),
      required: z.boolean(),
      index: z.boolean().optional(),
      projects: z.string().array().optional(),
      section: z.enum(["feature", "experiment"]),
    }),
  }),
  customFieldController.putCustomField
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
  customFieldController.deleteCustomField
);

export { router as customFieldsRouter };
