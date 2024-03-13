import express from "express";
import z from "zod";
import { validateRequestMiddleware } from "@/src/routers/utils/validateRequestMiddleware";
import { wrapController } from "@/src/routers//wrapController";
import * as rawEventsController from "./events.controller";

const router = express.Router();

const eventsController = wrapController(rawEventsController);

router.get("/", eventsController.getEvents);

router.get(
  "/:id",
  validateRequestMiddleware({
    params: z
      .object({
        id: z.string(),
      })
      .strict(),
  }),
  eventsController.getEventById
);

export { router as eventsRouter };
