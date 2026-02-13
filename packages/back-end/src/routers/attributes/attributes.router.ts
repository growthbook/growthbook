import express from "express";
import { z } from "zod";
import { attributeDataTypes } from "shared/constants";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawAttributesController from "./attributes.controller.js";

const router = express.Router();

const AttributeController = wrapController(rawAttributesController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      property: z.string(),
      description: z.string().optional(),
      datatype: z.enum(attributeDataTypes),
      projects: z.array(z.string()),
      format: z.string().optional(),
      enum: z.string().optional(),
      hashAttribute: z.boolean().optional(),
    }),
  }),
  AttributeController.postAttribute,
);

router.put(
  "/",
  validateRequestMiddleware({
    body: z.object({
      property: z.string(),
      description: z.string().optional(),
      datatype: z.enum(attributeDataTypes),
      projects: z.array(z.string()).optional(),
      format: z.string().optional(),
      enum: z.string().optional(),
      hashAttribute: z.boolean().optional(),
      archived: z.boolean().optional(),
      previousName: z.string().optional(),
    }),
  }),
  AttributeController.putAttribute,
);

router.delete(
  "/",
  validateRequestMiddleware({
    body: z.object({
      id: z.string(),
    }),
  }),
  AttributeController.deleteAttribute,
);

export { router as AttributeRouter };
