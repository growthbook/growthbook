import mongoose from "mongoose";
import { WatchInterface } from "../../types/watch";

const watchSchema = new mongoose.Schema({
  userId: String,
  organization: String,
  experiments: [String],
  features: [String],
});
watchSchema.index({ userId: 1, organization: 1 }, { unique: true });

export type WatchDocument = mongoose.Document & WatchInterface;

export const WatchModel = mongoose.model<WatchInterface>("Watch", watchSchema);
