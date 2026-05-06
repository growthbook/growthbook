import express from "express";
import { z } from "zod";
import { attributeDataTypes } from "shared/constants";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawAttributesController from "./attributes.controller";

const router = express.Router();

const AttributeController = wrapController(rawAttributesController);

router.get(
  "/references",
  validateRequestMiddleware({
    query: z.object({ ids: z.string().optional() }).strict(),
  }),
  AttributeController.getAttributeReferences,
);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      property: z.string(),
      description: z.string().nullish(),
      datatype: z.enum(attributeDataTypes),
      projects: z.array(z.string()).nullish(),
      format: z.string().nullish(),
      enum: z.string().nullish(),
      hashAttribute: z.boolean().nullish(),
      disableEqualityConditions: z.boolean().nullish(),
      tags: z.array(z.string()).nullish(),
    }),
  }),
  AttributeController.postAttribute,
);

router.put(
  "/",
  validateRequestMiddleware({
    body: z.object({
      property: z.string(),
      description: z.string().nullish(),
      datatype: z.enum(attributeDataTypes),
      projects: z.array(z.string()).nullish(),
      format: z.string().nullish(),
      enum: z.string().nullish(),
      hashAttribute: z.boolean().nullish(),
      archived: z.boolean().nullish(),
      previousName: z.string().nullish(),
      disableEqualityConditions: z.boolean().nullish(),
      tags: z.array(z.string()).nullish(),
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
