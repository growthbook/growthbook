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
export type SegmentDocument = mongoose.Document & SegmentInterface;

export const SegmentModel = mongoose.model<SegmentDocument>(
  "Segment",
  segmentSchema
);
