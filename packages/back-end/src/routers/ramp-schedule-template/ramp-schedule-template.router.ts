import express from "express";
import { reorderRampScheduleTemplatesValidator } from "shared/validators";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./ramp-schedule-template.controller";

const router = express.Router();
const ctrl = wrapController(rawController);

router.get("/", ctrl.getRampScheduleTemplates);
router.post("/", ctrl.postRampScheduleTemplate);
router.post(
  "/reorder",
  validateRequestMiddleware({
    body: reorderRampScheduleTemplatesValidator,
  }),
  ctrl.reorderRampScheduleTemplates,
);
router.get("/:id", ctrl.getRampScheduleTemplate);
router.put("/:id", ctrl.putRampScheduleTemplate);
router.delete("/:id", ctrl.deleteRampScheduleTemplate);

export { router as rampScheduleTemplateRouter };
