import mongoose from "mongoose";
import { PresentationThemeInterface } from "shared/types/presentation";

const presentationThemeSchema = new mongoose.Schema({
  id: String,
  organization: String,
  userId: String,
  name: String,
  customTheme: {
    backgroundColor: String,
    textColor: String,
    headingFont: String,
    bodyFont: String,
  },
  transition: String,
  celebration: String,
  logoUrl: String,
  dateCreated: Date,
  dateUpdated: Date,
});

export type PresentationThemeDocument = mongoose.Document &
  PresentationThemeInterface;

export const PresentationThemeModel =
  mongoose.model<PresentationThemeInterface>(
    "PresentationTheme",
    presentationThemeSchema,
  );
