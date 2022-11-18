import { EventEmitter } from "node:events";
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
import { randomUUID } from "crypto";

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

let jobIsDefined = false;

export class FeatureUpdatedNotifier implements Notifier {
  public static JOB_NAME = "events.feature.updated";

  private eventEmitter: EventEmitter;

  constructor(private agenda: Agenda = getAgendaInstance()) {
    this.eventEmitter = getEventEmitterInstance();

    if (jobIsDefined) return;

    this.agenda.define<EnqueuedData>(
      FeatureUpdatedNotifier.JOB_NAME,
      async (job: Job<EnqueuedData>) => {
        const { featureId, organizationId } = job.attrs.data;

        const data: ApiFeatureInterface = await getApiFeatureObjForFeatureIdOrganizationId(
          featureId,
          organizationId
        );

        const payload: FeatureUpdatedNotificationEvent = {
          event_id: `event-${randomUUID()}`,
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

    jobIsDefined = true;
  }

  async enqueue(featureId: string, organizationId: string): Promise<void> {
    this.agenda.now<EnqueuedData>(FeatureUpdatedNotifier.JOB_NAME, {
      featureId,
      organizationId,
    });
  }
}
