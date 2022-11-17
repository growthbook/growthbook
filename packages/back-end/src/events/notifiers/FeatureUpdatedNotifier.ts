import { EventEmitter } from "node:events";
import Agenda, { Job, JobAttributesData } from "agenda";
import { getAgendaInstance } from "../../services/queueing";
import { ApiFeatureInterface } from "../../../types/api";
import { getApiFeatureObjForFeatureIdOrganizationId } from "../../services/features";
import { FeatureUpdatedNotificationEvent } from "../base-events";
import { NotificationEventHandler } from "../base-types";
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
  public static JOB_NAME = "events.feature.updated";

  private eventEmitter: EventEmitter;

  constructor(private agenda: Agenda = getAgendaInstance()) {
    this.eventEmitter = getEventEmitterInstance();

    this.agenda.define<EnqueuedData>(
      FeatureUpdatedNotifier.JOB_NAME,
      async (job: Job<EnqueuedData>) => {
        const { featureId, organizationId } = job.attrs.data;

        const data: ApiFeatureInterface = await getApiFeatureObjForFeatureIdOrganizationId(
          featureId,
          organizationId
        );

        const payload: FeatureUpdatedNotificationEvent = {
          object: "feature",
          event: "feature.updated",
          data,
        };

        this.eventEmitter.emit(FeatureUpdatedNotifier.JOB_NAME, payload);
      }
    );
  }

  async enqueue(featureId: string, organizationId: string): Promise<void> {
    this.agenda.now<EnqueuedData>(FeatureUpdatedNotifier.JOB_NAME, {
      featureId,
      organizationId,
    });
  }
}
