import { OpenApiRoute } from "back-end/src/util/handler";
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

export const rampSchedulesRoutes: OpenApiRoute[] = [
  // CRUD
  listRampSchedules,
  postRampSchedule,
  getRampSchedule,
  putRampSchedule,
  deleteRampSchedule,
  // Actions
  startRampSchedule,
  pauseRampSchedule,
  resumeRampSchedule,
  rollbackRampSchedule,
  jumpRampSchedule,
  completeRampSchedule,
  approveStepRampSchedule,
  addTargetRampSchedule,
  ejectTargetRampSchedule,
];
