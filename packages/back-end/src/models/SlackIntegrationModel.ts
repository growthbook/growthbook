import { randomUUID } from "crypto";
import mongoose from "mongoose";
import omit from "lodash/omit";
import pick from "lodash/pick";
import { z } from "zod";
import { SlackIntegrationInterface } from "../../types/slack-integration";
import {
  NotificationEventName,
  notificationEventNames,
} from "../events/base-types";
import { logger } from "../util/logger";
import { errorStringFromZodResult } from "../util/validation";

const slackIntegrationSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
    required: true,
  },
  organizationId: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
  },
  dateCreated: {
    type: Date,
    required: true,
  },
  dateUpdated: {
    type: Date,
    required: true,
  },
  project: {
    type: String,
    required: false,
  },
  environments: {
    type: [String],
    required: true,
  },
  events: {
    type: [String],
    required: true,
    validate: {
      validator(value: unknown) {
        const zodSchema = z.array(z.enum(notificationEventNames));

        const result = zodSchema.safeParse(value);

        if (!result.success) {
          const errorString = errorStringFromZodResult(result);
          logger.error(errorString, "Invalid Event name");
        }

        return result.success;
      },
    },
  },
  tags: {
    type: [String],
    required: true,
  },
  slackAppId: {
    type: String,
    required: true,
  },
  slackSigningKey: {
    type: String,
    required: true,
  },
  linkedByUserId: {
    type: String,
    required: true,
  },
});

slackIntegrationSchema.index({ organizationId: 1 });

type SlackIntegrationDocument = mongoose.Document & SlackIntegrationInterface;

/**
 * Convert the Mongo document to a SlackIntegrationInterface by omitting Mongo default fields __v, _id
 * @param doc
 * @returns
 */
const toInterface = (
  doc: SlackIntegrationDocument
): SlackIntegrationInterface =>
  omit(doc.toJSON(), ["__v", "_id"]) as SlackIntegrationInterface;

const SlackIntegrationModel = mongoose.model<SlackIntegrationDocument>(
  "SlackIntegration",
  slackIntegrationSchema
);

// region Create

type CreateOptions = {
  organizationId: string;
  name: string;
  description: string;
  project: string | null;
  environments: string[];
  events: NotificationEventName[];
  tags: string[];
  slackAppId: string;
  slackSigningKey: string;
  linkedByUserId: string;
};

export const createSlackIntegration = async ({
  organizationId,
  name,
  description,
  project,
  environments,
  events,
  tags,
  slackAppId,
  slackSigningKey,
  linkedByUserId,
}: CreateOptions): Promise<SlackIntegrationInterface> => {
  const now = new Date();

  const doc = await SlackIntegrationModel.create({
    id: `sli-${randomUUID()}`,
    dateCreated: now,
    dateUpdated: now,
    organizationId,
    name,
    description,
    project,
    environments,
    events,
    tags,
    slackAppId,
    slackSigningKey,
    linkedByUserId,
  });

  return toInterface(doc);
};

// endregion Create

// region Read

export const getSlackIntegrations = async (
  organizationId: string
): Promise<SlackIntegrationInterface[]> => {
  const docs = await SlackIntegrationModel.find({
    organizationId,
  });
  return docs.map(toInterface);
};

type GetOptions = {
  slackIntegrationId: string;
  organizationId: string;
};

/**
 * Retrieve a SlackIntegration
 * @param slackIntegrationId
 * @param organizationId
 */
export const getSlackIntegration = async ({
  slackIntegrationId,
  organizationId,
}: GetOptions): Promise<SlackIntegrationInterface | null> => {
  try {
    const doc = await SlackIntegrationModel.findOne({
      id: slackIntegrationId,
      organizationId,
    });
    return !doc ? null : toInterface(doc);
  } catch (e) {
    logger.error(e, "getSlackIntegration");
    return null;
  }
};

type GetForEventOptions = {
  organizationId: string;
  eventName: NotificationEventName;
  environments: string[];
  tags: string[];
  projects: string[];
};

/**
 * Filters by the following:
 *  eventName:
 *    If the integration's events includes the provided event, or
 *    if the integration does not specify events,
 *    it will be included.
 *  environments:
 *    If the integration's environments intersects with the integration's environments, or
 *    if the integration does not specify environments,
 *    it will be included.
 *  tags:
 *    If the integration's tags intersects with the integration's tags, or
 *    if the integration does not specify tags,
 *    it will be included.
 *  projects:
 *    If the integration's projects intersects with the integration's projects, or
 *    if the integration does not specify projects,
 *    it will be included.
 * @param organizationId
 * @param eventName
 * @param environments
 * @param tags
 * @param projects
 */
export const getSlackIntegrationsForFilters = async ({
  organizationId,
  eventName,
  environments,
  tags,
  projects,
}: GetForEventOptions): Promise<SlackIntegrationInterface[] | null> => {
  try {
    const docs = await SlackIntegrationModel.find({
      organizationId,
      $and: [
        // Provided event or empty event filters
        {
          $or: [
            {
              events: {
                $in: [eventName],
              },
            },
            {
              events: {
                $size: 0,
              },
            },
          ],
        },

        // intersecting environments or empty environment filters
        {
          $or: [
            {
              environments: {
                $in: environments,
              },
            },
            {
              environments: {
                $size: 0,
              },
            },
          ],
        },

        // intersecting tags or empty tags filters
        {
          $or: [
            {
              tags: {
                $in: tags,
              },
            },
            {
              tags: {
                $size: 0,
              },
            },
          ],
        },

        // intersecting projects or empty projects filters
        {
          $or: [
            {
              projects: {
                $in: projects,
              },
            },
            {
              projects: {
                $size: 0,
              },
            },
          ],
        },
      ],
    });

    return docs.map(toInterface);
  } catch (e) {
    logger.error(e, "getSlackIntegrationsForEvent");
    return null;
  }
};

// endregion Read

// region Update

type UpdateOptions = {
  slackIntegrationId: string;
  organizationId: string;
};

type UpdateAttributes = {
  name: string;
  description: string;
  project: string | null;
  environments: string[];
  events: NotificationEventName[];
  tags: string[];
  slackAppId: string;
  slackSigningKey: string;
};

/**
 * Given a SlackIntegration.id, allows updating some properties
 * @param slackIntegrationId
 * @param organizationId
 * @param updates
 */
export const updateSlackIntegration = async (
  { slackIntegrationId, organizationId }: UpdateOptions,
  updates: UpdateAttributes
): Promise<boolean> => {
  const result = await SlackIntegrationModel.updateOne(
    { id: slackIntegrationId, organizationId },
    {
      $set: {
        ...pick(updates, [
          "name",
          "description",
          "project",
          "environments",
          "events",
          "tags",
          "slackAppId",
          "slackSigningKey",
        ]),
        dateUpdated: new Date(),
      },
    }
  );

  return result.nModified === 1;
};

// endregion Update

// region Delete

type DeleteOptions = {
  slackIntegrationId: string;
  organizationId: string;
};

/**
 * Delete a Slack integration for an organization
 * @param slackIntegrationId
 * @param organizationId
 */
export const deleteSlackIntegration = async ({
  slackIntegrationId,
  organizationId,
}: DeleteOptions): Promise<boolean> => {
  const result = await SlackIntegrationModel.deleteOne({
    id: slackIntegrationId,
    organizationId,
  });

  return result.deletedCount === 1;
};

// endregion Delete
