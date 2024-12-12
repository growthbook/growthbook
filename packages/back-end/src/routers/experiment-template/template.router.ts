import express from "express";
import z from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawtemplateController from "./template.controller";
import { createTemplateValidator } from "./template.validators";

const router = express.Router();

const templateController = wrapController(rawtemplateController);

router.post(
  "/",
  validateRequestMiddleware({
    body: createTemplateValidator,
  }),
  templateController.postTemplate
);

// router.put(
//   "/:id",
//   validateRequestMiddleware({
//     params: z
//       .object({
//         id: z.string(),
//       })
//       .strict(),
//     body: z
//       .object({
//         name: z.string(),
//         description: z.string(),
//       })
//       .strict(),
//   }),
//   templateController.putTemplate
// );

// router.delete(
//   "/:id",
//   validateRequestMiddleware({
//     params: z
//       .object({
//         id: z.string(),
//       })
//       .strict(),
//   }),
//   templateController.deleteTemplate
// );

export { router as templateRouter };
