import { OpenApiRoute } from "back-end/src/util/handler";
import {
  startRampSchedule,
  pauseRampSchedule,
  resumeRampSchedule,
  retryRampSchedule,
  jumpRampSchedule,
  completeRampSchedule,
  approveStepRampSchedule,
  rollbackRampSchedule,
  restartRampSchedule,
  addTargetRampSchedule,
  ejectTargetRampSchedule,
  apiAdvanceRampSchedule,
  getRampScheduleStatus,
  setMonitoringModeRampSchedule,
  setAutoUpdateRampSchedule,
  updateMonitoringConfigRampSchedule,
  updateLockdownConfigRampSchedule,
  updateStepsRampSchedule,
  refreshMonitoringRampSchedule,
} from "./rampScheduleActions";
import { listRampSchedules } from "./listRampSchedules";
import { postRampSchedule } from "./postRampSchedule";
import {
  pauseMatchingRampSchedules,
  rollbackMatchingRampSchedules,
} from "./alertRampSchedules";

export const rampSchedulesRoutes: OpenApiRoute[] = [
  // CRUD
  listRampSchedules,
  postRampSchedule,
  // Actions
  startRampSchedule,
  pauseRampSchedule,
  resumeRampSchedule,
  retryRampSchedule,
  rollbackRampSchedule,
  restartRampSchedule,
  jumpRampSchedule,
  completeRampSchedule,
  approveStepRampSchedule,
  addTargetRampSchedule,
  ejectTargetRampSchedule,
  apiAdvanceRampSchedule,
  getRampScheduleStatus,
  setMonitoringModeRampSchedule,
  setAutoUpdateRampSchedule,
  updateMonitoringConfigRampSchedule,
  updateLockdownConfigRampSchedule,
  updateStepsRampSchedule,
  refreshMonitoringRampSchedule,
  // Alert webhooks, across every matching ramp
  rollbackMatchingRampSchedules,
  pauseMatchingRampSchedules,
];
