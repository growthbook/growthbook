import express from "express";
import { wrapController } from "back-end/src/routers/wrapController";
import * as rawController from "./ramp-schedule-template.controller";

const router = express.Router();
const ctrl = wrapController(rawController);

router.get("/", ctrl.getRampScheduleTemplates);
router.post("/", ctrl.postRampScheduleTemplate);
router.get("/:id", ctrl.getRampScheduleTemplate);
router.put("/:id", ctrl.putRampScheduleTemplate);
router.delete("/:id", ctrl.deleteRampScheduleTemplate);

export { router as rampScheduleTemplateRouter };
