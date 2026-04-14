import { Router } from "express";
import { listRampSchedules } from "./listRampSchedules";
import { getRampSchedule } from "./getRampSchedule";
import { postRampSchedule } from "./postRampSchedule";
import { putRampSchedule } from "./putRampSchedule";
import { deleteRampSchedule } from "./deleteRampSchedule";
import {
  startRampSchedule,
  pauseRampSchedule,
  resumeRampSchedule,
  jumpRampSchedule,
  completeRampSchedule,
  approveStepRampSchedule,
  rollbackRampSchedule,
  addTargetRampSchedule,
  ejectTargetRampSchedule,
} from "./rampScheduleActions";

const router = Router();

// Mounted at /api/v1/ramp-schedules

// CRUD
router.get("/", listRampSchedules);
router.post("/", postRampSchedule);
router.get("/:id", getRampSchedule);
router.put("/:id", putRampSchedule);
router.delete("/:id", deleteRampSchedule);

// Actions
router.post("/:id/actions/start", startRampSchedule);
router.post("/:id/actions/pause", pauseRampSchedule);
router.post("/:id/actions/resume", resumeRampSchedule);
router.post("/:id/actions/rollback", rollbackRampSchedule); // rolls back to start, lands in "paused" for restart
router.post("/:id/actions/jump", jumpRampSchedule); // jump to a specific step
router.post("/:id/actions/complete", completeRampSchedule);
router.post("/:id/actions/approve-step", approveStepRampSchedule);
router.post("/:id/actions/add-target", addTargetRampSchedule);
router.post("/:id/actions/eject-target", ejectTargetRampSchedule);

export default router;
