import express from "express";
import z from "zod";
import { wrapController } from "../wrapController";
import * as rawEventsController from "./events.controller";
import { validateRequestMiddleware } from "../utils/validateRequestMiddleware";

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
