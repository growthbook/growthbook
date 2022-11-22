import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import Agenda, { Job, JobAttributesData } from "agenda";
import { getAgendaInstance } from "../../services/queueing";
import { ApiFeatureInterface } from "../../../types/api";
import { getApiFeatureObjForFeatureIdOrganizationId } from "../../services/features";
import { FeatureUpdatedNotificationEvent } from "../base-events";
import {
  APP_NOTIFICATION_EVENT_EMITTER_NAME,
  NotificationEventHandler,
} from "../base-types";
import { getEventEmitterInstance } from "../../services/event-emitter";

interface Notifier {
  enqueue(featureId: string, organizationId: string): Promise<void>;
}

interface EnqueuedData extends JobAttributesData {
  featureId: string;
  organizationId: string;
}

/**
 * Handle the notifications sent by the FeatureUpdatedNotifier.
 * Example usage:
 *
 *  const myHandler: FeatureUpdatedNotificationHandler = async (payload) => {
 *    const feature: ApiFeatureInterface = payload.data;
 *    // Do async things
 *  };
 */
export type FeatureUpdatedNotificationHandler = NotificationEventHandler<
  FeatureUpdatedNotificationEvent,
  void
>;

export class FeatureUpdatedNotifier implements Notifier {
  private static JOB_NAME = "events.feature.updated";

  // Agenda ID = JOB_NAME + eventId
  private readonly agendaId: string;

  private eventEmitter: EventEmitter;

  constructor(private agenda: Agenda = getAgendaInstance()) {
    const eventId = `event-${randomUUID()}`;

    this.agendaId = `${FeatureUpdatedNotifier.JOB_NAME}-${eventId}`;

    this.eventEmitter = getEventEmitterInstance();

    this.agenda.define<EnqueuedData>(
      this.agendaId,
      async (job: Job<EnqueuedData>) => {
        const { featureId, organizationId } = job.attrs.data;

        const data: ApiFeatureInterface = await getApiFeatureObjForFeatureIdOrganizationId(
          featureId,
          organizationId
        );

        const payload: FeatureUpdatedNotificationEvent = {
          event_id: eventId,
          object: "feature",
          event: "feature.updated",
          data: {
            ...data,
            organizationId,
          },
        };

        this.eventEmitter.emit(APP_NOTIFICATION_EVENT_EMITTER_NAME, payload);
      }
    );
  }

  async enqueue(featureId: string, organizationId: string): Promise<void> {
    this.agenda.now<EnqueuedData>(this.agendaId, {
      featureId,
      organizationId,
    });
  }
}
