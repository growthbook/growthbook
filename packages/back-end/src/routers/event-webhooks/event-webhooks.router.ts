import express from "express";
import * as rawEventWebHooksController from "./event-webhooks.controller";
import { wrapController } from "../wrapController";

const router = express.Router();

const eventWebHooksController = wrapController(rawEventWebHooksController);

router.get("/", eventWebHooksController.getEventWebHooks);

export { router as eventWebHooksRouter };
