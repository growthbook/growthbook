import express from "express";
import { z } from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import { attributeDataTypes } from "../../util/organization.util";
import * as rawAttributesController from "./attributes.controller";

const router = express.Router();

const AttributeController = wrapController(rawAttributesController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      property: z.string(),
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
      datatype: z.enum(attributeDataTypes),
      projects: z.array(z.string()),
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
