import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import {
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "shared/types/experimentLaunchChecklist";
import { ReqContext } from "back-end/types/request";
import { ApiReqContext } from "back-end/types/api";

const experimentLaunchChecklistSchema = new mongoose.Schema({
  id: String,
  organizationId: String,
  dateCreated: Date,
  dateUpdated: Date,
  updatedByUserId: String,
  projectId: String, //TODO: This won't be used until we add support for project-level checklists
  tasks: [
    {
      task: String,
      completionType: { type: String, enum: ["manual", "auto"] },
      customFieldId: String,
      propertyKey: {
        type: String,
        enum: [
          "description",
          "hypothesis",
          "project",
          "tag",
          "screenshots",
          "customField",
          "prerequisiteTargeting",
        ],
      },
      url: String,
    },
  ],
});

export type ExperimentLaunchChecklistDocument = mongoose.Document &
  ExperimentLaunchChecklistInterface;

export const ExperimentLaunchChecklistModel =
  mongoose.model<ExperimentLaunchChecklistInterface>(
    "ExperimentLaunchChecklist",
    experimentLaunchChecklistSchema,
  );

function toInterface(
  doc: ExperimentLaunchChecklistDocument,
): ExperimentLaunchChecklistInterface {
  return omit(doc.toJSON<ExperimentLaunchChecklistDocument>(), ["__v", "_id"]);
}

export async function createExperimentLaunchChecklist(
  organizationId: string,
  createdByUserId: string,
  tasks: ChecklistTask[],
  projectId: string,
): Promise<ExperimentLaunchChecklistInterface> {
  const doc: ExperimentLaunchChecklistDocument =
    await ExperimentLaunchChecklistModel.create({
      id: uniqid("exp-list-"),
      organizationId,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      updatedByUserId: createdByUserId,
      createdByUserId,
      tasks,
      projectId,
    });

  return toInterface(doc);
}

export async function getExperimentLaunchChecklist(
  organizationId: string,
  projectId: string,
): Promise<ExperimentLaunchChecklistInterface | null> {
  const doc: ExperimentLaunchChecklistDocument | null =
    await ExperimentLaunchChecklistModel.findOne({
      organizationId,
      projectId,
    });

  return doc ? toInterface(doc) : null;
}

export async function getExperimentLaunchChecklistById(
  organizationId: string,
  id: string,
): Promise<ExperimentLaunchChecklistInterface | null> {
  const doc: ExperimentLaunchChecklistDocument | null =
    await ExperimentLaunchChecklistModel.findOne({
      organizationId,
      id,
    });
  return doc ? toInterface(doc) : null;
}

export async function updateExperimentLaunchChecklist(
  organizationId: string,
  updatedByUserId: string,
  checklistId: string,
  tasks: ChecklistTask[],
): Promise<ExperimentLaunchChecklistInterface | null> {
  const doc: ExperimentLaunchChecklistDocument | null =
    await ExperimentLaunchChecklistModel.findOneAndUpdate(
      {
        organizationId,
        id: checklistId,
      },
      {
        dateUpdated: new Date(),
        updatedByUserId,
        tasks,
      },
    );

  return doc ? toInterface(doc) : null;
}

export async function deleteExperimentLaunchChecklist(
  context: ReqContext | ApiReqContext,
  checklistId: string,
): Promise<void> {
  await ExperimentLaunchChecklistModel.deleteOne({
    organizationId: context.org.id,
    id: checklistId,
  });
}
