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

export const rampSchedulesRoutes: OpenApiRoute[] = [
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
