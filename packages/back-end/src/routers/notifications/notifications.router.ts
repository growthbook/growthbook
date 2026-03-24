import express from "express";
import { z } from "zod";
import { wrapController } from "back-end/src/routers/wrapController";
import { validateRequestMiddleware } from "back-end/src/routers/utils/validateRequestMiddleware";
import * as notificationsControllerRaw from "./notifications.controller";

const router = express.Router();
const notificationsController = wrapController(notificationsControllerRaw);

router.get("/", notificationsController.getNotifications);
router.get("/counts", notificationsController.getNotificationCounts);
router.post(
  "/seen",
  validateRequestMiddleware({
    body: z.strictObject({ ids: z.array(z.string()) }),
  }),
  notificationsController.postNotificationsSeen,
);
router.post("/read-all", notificationsController.postNotificationsReadAll);
router.post("/:id/read", notificationsController.postNotificationRead);
router.post("/:id/dismiss", notificationsController.postNotificationDismiss);

export { router as notificationsRouter };
