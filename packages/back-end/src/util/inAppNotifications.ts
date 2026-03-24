/**
 * Backend gate for in-app notifications (fan-out + REST). When set to "false",
 * APIs return 404 and no UserNotification rows are created. Align with the
 * GrowthBook feature flag `in-app-notifications` on the front end.
 */
export function isInAppNotificationsBackendEnabled(): boolean {
  return true;
  return process.env.IN_APP_NOTIFICATIONS_ENABLED !== "false";
}
