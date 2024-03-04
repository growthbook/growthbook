import express from "express";
import { z } from "zod";
import { wrapController } from "../wrapController";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";
import * as rawAttributesController from "./attributes.controller";

const router = express.Router();

const AttributeController = wrapController(rawAttributesController);

router.post(
  "/",
  validateRequestMiddleware({
    body: z.object({
      property: z.string(),
      datatype: z.string(), // can this do enums?
      projects: z.array(z.string()),
      format: z.string(),
      enum: z.string(),
      hashAttribute: z.boolean().optional(),
    }),
  }),
  AttributeController.postAttribute
);

export { router as AttributeRouter };
