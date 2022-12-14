import mongoose from "mongoose";
import { SegmentInterface } from "../../types/segment";
import { getConfigSegments, usingFileConfig } from "../init/config";

const segmentSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  owner: String,
  datasource: String,
  userIdType: String,
  name: String,
  sql: String,
  dateCreated: Date,
  dateUpdated: Date,
});
export type SegmentDocument = mongoose.Document & SegmentInterface;

const SegmentModel = mongoose.model<SegmentDocument>("Segment", segmentSchema);

function toInterface(doc: SegmentDocument): SegmentInterface {
  return doc.toJSON();
}

export async function createSegment(segment: Partial<SegmentInterface>) {
  return toInterface(await SegmentModel.create(segment));
}

export async function findSegmentById(id: string, organization: string) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigSegments(organization).filter((s) => s.id === id)[0];
  }

  const doc = await SegmentModel.findOne({ id, organization });

  return doc ? toInterface(doc) : null;
}

export async function findSegmentsByOrganization(organization: string) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigSegments(organization);
  }

  return (await SegmentModel.find({ organization })).map(toInterface);
}

export async function findSegmentsByDataSource(
  datasource: string,
  organization: string
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    return getConfigSegments(organization).filter(
      (s) => s.datasource === datasource
    );
  }

  return (await SegmentModel.find({ datasource, organization })).map(
    toInterface
  );
}

export async function deleteSegmentById(id: string, organization: string) {
  // If using config.yml, immediately throw error
  if (usingFileConfig()) {
    throw new Error("Cannot delete. Segments are being managed by config.yml");
  }

  await SegmentModel.deleteOne({ id, organization });
}

export async function updateSegment(
  id: string,
  organization: string,
  updates: Partial<SegmentInterface>
) {
  // If using config.yml, immediately return the list from there
  if (usingFileConfig()) {
    throw new Error("Cannot update. Segments are being managed by config.yml");
  }

  await SegmentModel.updateOne({ id, organization }, { $set: updates });
}
