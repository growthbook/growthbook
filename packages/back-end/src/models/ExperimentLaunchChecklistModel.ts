import mongoose from "mongoose";
import uniqid from "uniqid";
import { omit } from "lodash";
import {
  ChecklistTask,
  ExperimentLaunchChecklistInterface,
} from "../../types/experimentLaunchChecklist";

const experimentLaunchChecklistSchema = new mongoose.Schema({
  id: String,
  organizationId: String,
  dateCreated: Date,
  dateUpdated: Date,
  updatedByUserId: String,
  tasks: [
    {
      task: String,
      completionType: { type: String, enum: ["manual", "auto"] },
      propertyKey: {
        type: String,
        enum: ["description", "hypothesis", "project", "tag", "screenshots"],
      },
    },
  ],
});

export type ExperimentLaunchChecklistDocument = mongoose.Document &
  ExperimentLaunchChecklistInterface;

export const ExperimentLaunchChecklistModel = mongoose.model<ExperimentLaunchChecklistInterface>(
  "ExperimentLaunchChecklist",
  experimentLaunchChecklistSchema
);

function toInterface(
  doc: ExperimentLaunchChecklistDocument
): ExperimentLaunchChecklistInterface {
  return omit(doc.toJSON<ExperimentLaunchChecklistDocument>(), ["__v", "_id"]);
}

export async function createExperimentLaunchChecklist(
  organizationId: string,
  createdByUserId: string,
  tasks: ChecklistTask[]
): Promise<ExperimentLaunchChecklistInterface> {
  const doc: ExperimentLaunchChecklistDocument = await ExperimentLaunchChecklistModel.create(
    {
      id: uniqid("exp-list-"),
      organizationId,
      dateCreated: new Date(),
      dateUpdated: new Date(),
      updatedByUserId: createdByUserId,
      createdByUserId,
      tasks,
    }
  );

  return toInterface(doc);
}

export async function getExperimentLaunchChecklistByOrgIg(
  organizationId: string
): Promise<ExperimentLaunchChecklistInterface | null> {
  const doc: ExperimentLaunchChecklistDocument | null = await ExperimentLaunchChecklistModel.findOne(
    {
      organizationId,
    }
  );

  return doc ? toInterface(doc) : null;
}

export async function updateExperimentLaunchChecklist(
  organizationId: string,
  updatedByUserId: string,
  checklistId: string,
  tasks: ChecklistTask[]
): Promise<ExperimentLaunchChecklistInterface | null> {
  const doc: ExperimentLaunchChecklistDocument | null = await ExperimentLaunchChecklistModel.findOneAndUpdate(
    {
      organizationId,
      id: checklistId,
    },
    {
      dateUpdated: new Date(),
      updatedByUserId,
      tasks,
    }
  );

  return doc ? toInterface(doc) : null;
}
