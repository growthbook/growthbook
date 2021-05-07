import mongoose from "mongoose";
import { SegmentInterface } from "../../types/segment";

const segmentSchema = new mongoose.Schema({
  id: String,
  organization: String,
  datasource: String,
  name: String,
  sql: String,
  dateCreated: Date,
  dateUpdated: Date,
  targeting: String,
});
export type SegmentDocument = mongoose.Document & SegmentInterface;

export const SegmentModel = mongoose.model<SegmentDocument>(
  "Segment",
  segmentSchema
);
