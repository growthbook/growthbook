import { LearningModel } from "../models/LearningsModel";
import uniqid from "uniqid";
import { addTags } from "./tag";
import { LearningInterface } from "../../types/insight";
//import {query} from "../config/postgres";

export function getLearningsByOrganization(organization: string) {
  return LearningModel.find({
    organization,
  });
}

export async function createLearning(data: Partial<LearningInterface>) {
  const learning = await LearningModel.create({
    // Default values that can be overridden

    // The data object passed in
    ...data,
    // Values that cannot be overridden
    id: uniqid("lrn_"),
    dateCreated: new Date(),
    dateUpdated: new Date(),
  });

  if (learning.tags) {
    await addTags(learning.organization, learning.tags);
  }

  return learning;
}

export function getLearningById(id: string) {
  return LearningModel.findOne({
    id,
  });
}

export function getLearningsByIds(ids: string[]) {
  return LearningModel.find({
    id: { $in: ids },
  });
}

export function getLearningsByExperimentIds(ids: string[]) {
  const tmp: { experimentId: string }[] = [];
  ids.map((id) => {
    tmp.push({ experimentId: id });
  });
  return LearningModel.find({
    evidence: { $in: tmp },
  });
}

export function deleteLearningById(id: string) {
  return LearningModel.deleteOne({
    id,
  });
}
