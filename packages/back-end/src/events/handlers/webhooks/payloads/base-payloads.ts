import { OrganizationInterface } from "../../../../../types/organization";
import { GroupMap } from "../../../../../types/saved-group";
import {
  NotificationEventName,
  NotificationEventPayload,
} from "../../../base-types";

type BasePayloadCreatorOptions = {
  organization: OrganizationInterface;
  savedGroupMap: GroupMap;
};

/**
 * All payload creators require this interface.
 * They are passed a generic event, and return a {@link NotificationEventPayload}
 */
export interface PayloadCreator<
  EventType,
  PayloadType extends NotificationEventPayload<
    NotificationEventName,
    unknown,
    unknown
  >
> {
  (params: BasePayloadCreatorOptions & { event: EventType }): PayloadType;
}
