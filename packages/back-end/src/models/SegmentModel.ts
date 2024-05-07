import omit from "lodash/omit";
import mongoose from "mongoose";
import { ApiSegment } from "../../types/openapi";
import { SegmentInterface } from "../../types/segment";
import { getConfigSegments, usingFileConfigForSegments } from "../init/config";

const segmentSchema = new mongoose.Schema({
  id: String,
  organization: {
    type: String,
    index: true,
  },
  owner: String,
  datasource: String,
  userIdType: String,
  description: String,
  name: String,
  sql: String,
  dateCreated: Date,
  dateUpdated: Date,
});

type SegmentDocument = mongoose.Document & SegmentInterface;

const SegmentModel = mongoose.model<SegmentInterface>("Segment", segmentSchema);

const toInterface = (doc: SegmentDocument): SegmentInterface =>
  omit(doc.toJSON<SegmentDocument>(), ["__v", "_id"]);

export async function createSegment(segment: Partial<SegmentInterface>) {
  return toInterface(await SegmentModel.create(segment));
}

export async function findSegmentById(id: string, organization: string) {
  // If using config.yml & the org doesn't have the env variable STORE_SEGMENTS_IN_MONGO,
  // immediately return the list from there
  if (usingFileConfigForSegments()) {
    return getConfigSegments(organization).filter((s) => s.id === id)[0];
  }

  const doc = await SegmentModel.findOne({ id, organization });

  return doc ? toInterface(doc) : null;
}

export async function findSegmentsByOrganization(organization: string) {
  // If using config.yml & the org doesn't have the env variable STORE_SEGMENTS_IN_MONGO,
  // immediately return the list from there
  if (usingFileConfigForSegments()) {
    return getConfigSegments(organization);
  }

  return (await SegmentModel.find({ organization })).map(toInterface);
}

export async function findSegmentsByDataSource(
  datasource: string,
  organization: string,
) {
  // If using config.yml & the org doesn't have the env variable STORE_SEGMENTS_IN_MONGO,
  // immediately return the list from there
  if (usingFileConfigForSegments()) {
    return getConfigSegments(organization).filter(
      (s) => s.datasource === datasource,
    );
  }

  return (await SegmentModel.find({ datasource, organization })).map(
    toInterface,
  );
}

export async function deleteSegmentById(id: string, organization: string) {
  // If using config.yml & the org doesn't have the env variable STORE_SEGMENTS_IN_MONGO,
  // immediately throw error
  if (usingFileConfigForSegments()) {
    throw new Error("Cannot delete. Segments are being managed by config.yml");
  }

  await SegmentModel.deleteOne({ id, organization });
}

export async function updateSegment(
  id: string,
  organization: string,
  updates: Partial<SegmentInterface>,
) {
  // If using config.yml & the org doesn't have the env variable STORE_SEGMENTS_IN_MONGO,
  // immediately return the list from there
  if (usingFileConfigForSegments()) {
    throw new Error("Cannot update. Segments are being managed by config.yml");
  }

  await SegmentModel.updateOne({ id, organization }, { $set: updates });
}

export function toSegmentApiInterface(segment: SegmentInterface): ApiSegment {
  return {
    id: segment.id,
    name: segment.name,
    owner: segment.owner || "",
    identifierType: segment.userIdType || "user_id",
    query: segment.sql,
    datasourceId: segment.datasource || "",
    dateCreated: segment.dateCreated?.toISOString() || "",
    dateUpdated: segment.dateUpdated?.toISOString() || "",
  };
}
