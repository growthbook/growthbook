import mongoose from "mongoose";
import omit from "lodash/omit";
import { ExperimentInterface } from "../../types/experiment";
import { OrganizationInterface } from "../../types/organization";
import {
  ExperimentCreatedNotificationEvent,
  ExperimentDeletedNotificationEvent,
  ExperimentUpdatedNotificationEvent,
} from "../events/base-events";
import { EventNotifier } from "../events/notifiers/EventNotifier";
import { createEvent } from "./EventModel";

export type ExperimentDocument = mongoose.Document & ExperimentInterface;

const experimentSchema = new mongoose.Schema({
  id: String,
  trackingKey: String,
  organization: {
    type: String,
    index: true,
  },
  project: String,
  owner: String,
  datasource: String,
  userIdType: String,
  exposureQueryId: String,
  name: String,
  dateCreated: Date,
  dateUpdated: Date,
  tags: [String],
  description: String,
  // Observations is not used anymore, keeping here so it will continue being saved in Mongo if present
  observations: String,
  hypothesis: String,
  metrics: [String],
  metricOverrides: [
    {
      _id: false,
      id: String,
      conversionWindowHours: Number,
      conversionDelayHours: Number,
      winRisk: Number,
      loseRisk: Number,
    },
  ],
  guardrails: [String],
  activationMetric: String,
  segment: String,
  queryFilter: String,
  skipPartialData: Boolean,
  removeMultipleExposures: Boolean,
  attributionModel: String,
  archived: Boolean,
  status: String,
  results: String,
  analysis: String,
  winner: Number,
  currentPhase: Number,
  autoAssign: Boolean,
  implementation: String,
  previewURL: String,
  targetURLRegex: String,
  variations: [
    {
      _id: false,
      name: String,
      description: String,
      key: String,
      value: String,
      screenshots: [
        {
          _id: false,
          path: String,
          width: Number,
          height: Number,
          description: String,
        },
      ],
      css: String,
      dom: [
        {
          _id: false,
          selector: String,
          action: String,
          attribute: String,
          value: String,
        },
      ],
    },
  ],
  phases: [
    {
      _id: false,
      dateStarted: Date,
      dateEnded: Date,
      phase: String,
      reason: String,
      coverage: Number,
      variationWeights: [Number],
      groups: [String],
    },
  ],
  data: String,
  lastSnapshotAttempt: Date,
  nextSnapshotAttempt: Date,
  autoSnapshots: Boolean,
  ideaSource: String,
});

export const ExperimentModel = mongoose.model<ExperimentDocument>(
  "Experiment",
  experimentSchema
);

const toInterface = (doc: ExperimentDocument): ExperimentInterface =>
  omit(doc.toJSON(), ["__v", "_id"]) as ExperimentInterface;

type FindOrganizationOptions = {
  experimentId: string;
  organizationId: string;
};

/**
 * Finds an experiment for an organization
 * @param experimentId
 * @param organizationId
 */
export const findExperiment = async ({
  experimentId,
  organizationId,
}: FindOrganizationOptions): Promise<ExperimentInterface | null> => {
  const doc = await ExperimentModel.findOne({
    id: experimentId,
    organization: organizationId,
  });
  return doc ? toInterface(doc) : null;
};

// region Events

/**
 * @param organization
 * @param experiment
 * @return event.id
 */
export const logExperimentCreated = async (
  organization: OrganizationInterface,
  experiment: ExperimentInterface
): Promise<string> => {
  const payload: ExperimentCreatedNotificationEvent = {
    object: "experiment",
    event: "experiment.created",
    data: {
      current: experiment,
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
  new EventNotifier(emittedEvent.id).perform();

  return emittedEvent.id;
};

/**
 * @param organization
 * @param experiment
 * @return event.id
 */
export const logExperimentUpdated = async ({
  organization,
  current,
  previous,
}: {
  organization: OrganizationInterface;
  current: ExperimentInterface;
  previous: ExperimentInterface;
}): Promise<string> => {
  const payload: ExperimentUpdatedNotificationEvent = {
    object: "experiment",
    event: "experiment.updated",
    data: {
      previous,
      current,
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
  new EventNotifier(emittedEvent.id).perform();

  return emittedEvent.id;
};

/**
 * @param organization
 * @param experiment
 * @return event.id
 */
export const logExperimentDeleted = async (
  organization: OrganizationInterface,
  experiment: ExperimentInterface
): Promise<string> => {
  const payload: ExperimentDeletedNotificationEvent = {
    object: "experiment",
    event: "experiment.deleted",
    data: {
      previous: experiment,
    },
  };

  const emittedEvent = await createEvent(organization.id, payload);
  new EventNotifier(emittedEvent.id).perform();

  return emittedEvent.id;
};

// endregion Events
