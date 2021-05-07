import mongoose from "mongoose";
import { PresentationInterface } from "../../types/presentation";

const presentationSchema = new mongoose.Schema({
  id: String,
  userId: String,
  organization: String,
  title: String,
  description: String,
  options: {},
  experimentIds: [String],
  dateCreated: Date,
  dateUpdated: Date,
});

export type PresentationDocument = mongoose.Document & PresentationInterface;

export const PresentationModel = mongoose.model<PresentationDocument>(
  "Presentation",
  presentationSchema
);
