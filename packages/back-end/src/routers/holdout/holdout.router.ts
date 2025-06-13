// write the router boilerplate for the holdout router

import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawHoldoutController from "./holdout.controller";

const router = express.Router();
const holdoutController = wrapController(rawHoldoutController);

export default router;
