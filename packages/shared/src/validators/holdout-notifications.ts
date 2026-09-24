import { z } from "zod";
import { holdoutStage } from "../util/holdouts";
import { ownerEmailField } from "./owner-field";

const holdoutNotification = z.object({
  holdoutId: z.string(),
  holdoutName: z.string(),
  ownerEmail: ownerEmailField,
});

export const holdoutCreatedNotificationPayload = holdoutNotification.strict();

export const holdoutStatusChangedNotificationPayload = holdoutNotification
  .extend({
    previousStatus: z.enum(holdoutStage),
    currentStatus: z.enum(holdoutStage),
  })
  .strict();

export const holdoutNewLinkageNotificationPayload = holdoutNotification
  .extend({
    featureIds: z.array(z.string()),
    experimentIds: z.array(z.string()),
  })
  .strict();
