import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as rawController from "./experiment-ramp-schedule.controller";

const router = express.Router({ mergeParams: true });

const controller = wrapController(rawController);

const idParam = z.object({ id: z.string() }).strict();

// GET /experiment/:id/ramp-schedule
router.get(
  "/",
  validateRequestMiddleware({ params: idParam }),
  controller.getRampSchedule,
);

// POST /experiment/:id/ramp-schedule  (attach)
router.post(
  "/",
  validateRequestMiddleware({ params: idParam }),
  controller.postRampSchedule,
);

// PUT /experiment/:id/ramp-schedule  (update config)
router.put(
  "/",
  validateRequestMiddleware({ params: idParam }),
  controller.putRampSchedule,
);

// DELETE /experiment/:id/ramp-schedule  (detach)
router.delete(
  "/",
  validateRequestMiddleware({ params: idParam }),
  controller.deleteRampSchedule,
);

// POST /experiment/:id/ramp-schedule/advance
router.post(
  "/advance",
  validateRequestMiddleware({ params: idParam }),
  controller.postAdvanceRamp,
);

// POST /experiment/:id/ramp-schedule/rollback
router.post(
  "/rollback",
  validateRequestMiddleware({ params: idParam }),
  controller.postRollbackRamp,
);

// POST /experiment/:id/ramp-schedule/pause
router.post(
  "/pause",
  validateRequestMiddleware({ params: idParam }),
  controller.postPauseRamp,
);

// POST /experiment/:id/ramp-schedule/resume
router.post(
  "/resume",
  validateRequestMiddleware({ params: idParam }),
  controller.postResumeRamp,
);

// POST /experiment/:id/ramp-schedule/approve-step
router.post(
  "/approve-step",
  validateRequestMiddleware({ params: idParam }),
  controller.postApproveRampStep,
);

// POST /experiment/:id/ramp-schedule/force-advance  (skip gates, manual override)
router.post(
  "/force-advance",
  validateRequestMiddleware({ params: idParam }),
  controller.postForceAdvanceRamp,
);

export { router as experimentRampScheduleRouter };
