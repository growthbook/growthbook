import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { WatchInterface } from "../../types/watch";

const watchSchema = new mongoose.Schema({
  userId: String,
  organization: String,
  experiments: [String],
  features: [String],
});
watchSchema.index({ userId: 1, organization: 1 }, { unique: true });

export type WatchDocument = mongoose.Document<
  ObjectId | undefined,
  Record<string, never>,
  WatchInterface
> &
  WatchInterface;

export const WatchModel = mongoose.model<WatchDocument>("Watch", watchSchema);
