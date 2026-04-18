import { OpenApiRoute } from "back-end/src/util/handler";
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
import { listRampSchedules } from "./listRampSchedules";
import { postRampSchedule } from "./postRampSchedule";

export const rampSchedulesRoutes: OpenApiRoute[] = [
  // CRUD
  listRampSchedules,
  postRampSchedule,
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
