import express from "express";
import { z } from "zod/v4";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import { attributeDataTypes } from "back-end/src/util/organization.util";
import * as rawAttributesController from "./attributes.controller";

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
      format: z.string(),
      enum: z.string(),
      hashAttribute: z.boolean().optional(),
    }),
  }),
  AttributeController.postAttribute
);

router.put(
  "/",
  validateRequestMiddleware({
    body: z.object({
      property: z.string(),
      description: z.string().optional(),
      datatype: z.enum(attributeDataTypes),
      projects: z.array(z.string()).optional(),
      format: z.string(),
      enum: z.string(),
      hashAttribute: z.boolean().optional(),
      archived: z.boolean().optional(),
      previousName: z.string().optional(),
    }),
  }),
  AttributeController.putAttribute
);

router.delete(
  "/",
  validateRequestMiddleware({
    body: z.object({
      id: z.string(),
    }),
  }),
  AttributeController.deleteAttribute
);

export { router as AttributeRouter };
