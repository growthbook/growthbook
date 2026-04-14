import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawController from "./ramp-schedule.controller";

const router = express.Router();
const ctrl = wrapController(rawController);

router.get("/", ctrl.getRampSchedules);
router.post("/", ctrl.postRampSchedule);
router.get("/:id", ctrl.getRampSchedule);
router.put("/:id", ctrl.putRampSchedule);
router.delete("/:id", ctrl.deleteRampSchedule);
router.post("/:id/actions/:action", ctrl.postRampScheduleAction);

export { router as rampScheduleRouter };
