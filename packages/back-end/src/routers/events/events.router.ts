import express from "express";
import { wrapController } from "../wrapController";
import * as rawEventsController from "./events.controller";

const router = express.Router();

const eventsController = wrapController(rawEventsController);

router.get("/", eventsController.getEvents);

export { router as eventsRouter };
