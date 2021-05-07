import mongoose from "mongoose";
import { WatchInterface } from "../../types/watch";

const watchSchema = new mongoose.Schema({
  userId: String,
  organization: String,
  experiments: [String],
});

export type WatchDocument = mongoose.Document & WatchInterface;

export const WatchModel = mongoose.model<WatchDocument>("Watch", watchSchema);
