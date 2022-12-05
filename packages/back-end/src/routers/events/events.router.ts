import express from "express";
import * as rawEventsController from "./events.controller";
import { wrapController } from "../wrapController";

const router = express.Router();

const eventsController = wrapController(rawEventsController);

router.get("/", eventsController.getEvents);

export { router as eventsRouter };
