import mongoose from "mongoose";
import { PresentationInterface } from "shared/types/presentation";

const presentationSchema = new mongoose.Schema({
  id: String,
  userId: String,
  organization: String,
  title: String,
  description: String,
  options: {
    showScreenShots: Boolean,
    showGraphs: Boolean,
    graphType: String,
    hideMetric: [String],
    hideRisk: Boolean,
  },
  slides: [
    {
      _id: false,
      type: { type: String },
      id: String,
      options: {
        showScreenShots: Boolean,
        showGraphs: Boolean,
        graphType: String,
        hideMetric: [String],
        hideRisk: Boolean,
      },
    },
  ],
  theme: String,
  customTheme: {
    backgroundColor: String,
    textColor: String,
    headingFont: String,
    bodyFont: String,
  },
  sharable: Boolean,
  voting: Boolean,
  dateCreated: Date,
  dateUpdated: Date,
});

export type PresentationDocument = mongoose.Document & PresentationInterface;

export const PresentationModel = mongoose.model<PresentationInterface>(
  "Presentation",
  presentationSchema,
);
