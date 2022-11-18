import z from "zod";
import _ from "lodash";
import mongoose from "mongoose";
import {
  NotificationEventName,
  notificationEventNames,
  NotificationEventPayload,
  NotificationEventResource,
  notificationEventResources,
} from "../events/base-types";
import { EventInterface } from "../../types/event";

const eventSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  dateCreated: Date,
  organizationId: {
    type: String,
    required: true,
  },
  data: {
    type: Object,
    required: true,
    validate: {
      validator(value: unknown) {
        // NotificationEventPayload<EventName, ResourceType, DataType>
        const zodSchema = z
          .object({
            event_id: z.string().startsWith("event-"),
            event: z.enum(notificationEventNames),
            object: z.enum(notificationEventResources),
            data: z.any(),
          })
          .strict();

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errors = result.error.issues.map((i) => {
            return "[" + i.path.join(".") + "] " + i.message;
          });
          console.error("Invalid Event data ", errors.join(", "));
        }

        return result.success;
      },
      message:
        "Data is invalid. Must be of type NotificationEventPayload<NotificationEventName, NotificationEventResource, any>",
    },
  },
});

type EventDocument<T> = mongoose.Document & EventInterface<T>;

const EventModel = mongoose.model<EventDocument<unknown>>("Event", eventSchema);

export const createEvent = async <
  EventName extends NotificationEventName,
  ResourceType extends NotificationEventResource,
  DataType
>(
  organizationId: string,
  data: NotificationEventPayload<EventName, ResourceType, DataType>
): Promise<EventInterface<DataType>> => {
  const doc = await EventModel.create({
    id: data.event_id,
    dateCreated: new Date(),
    organizationId,
    data,
  });

  return _.omit(doc.toJSON(), ["__v", "_id"]) as EventInterface<DataType>;
};
