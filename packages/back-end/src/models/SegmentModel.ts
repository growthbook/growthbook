import mongoose from "mongoose";
import { SegmentInterface } from "../../types/segment";

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

type SegmentDocument = mongoose.Document & SegmentInterface;

const SegmentModel = mongoose.model<SegmentDocument>("Segment", segmentSchema);

function toInterface(doc: SegmentDocument): SegmentInterface {
  return doc.toJSON();
}

export async function createSegment(segment: Partial<SegmentInterface>) {
  return toInterface(await SegmentModel.create(segment));
}

export async function findSegmentById(id: string, organization: string) {
  const doc = await SegmentModel.findOne({ id, organization });

  return doc ? toInterface(doc) : null;
}

export async function findSegmentsByOrganization(organization: string) {
  return (await SegmentModel.find({ organization })).map(toInterface);
}

export async function findSegmentsByDataSource(
  datasource: string,
  organization: string
) {
  return (await SegmentModel.find({ datasource, organization })).map(
    toInterface
  );
}

export async function deleteSegmentById(id: string, organization: string) {
  await SegmentModel.deleteOne({ id, organization });
}

export async function updateSegment(
  id: string,
  organization: string,
  updates: Partial<SegmentInterface>
) {
  await SegmentModel.updateOne({ id, organization }, { $set: updates });
}
