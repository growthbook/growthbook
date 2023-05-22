import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { RealtimeUsageInterface } from "../../types/realtime";

const realtimeUsageSchema = new mongoose.Schema({
  organization: String,
  hour: String,
  features: {},
});
realtimeUsageSchema.index({ organization: 1, hour: 1 }, { unique: true });

export type RealtimeUsageDocument = mongoose.Document<
  ObjectId | undefined,
  Record<string, never>,
  RealtimeUsageInterface
> &
  RealtimeUsageInterface;

export const RealtimeUsageModel = mongoose.model<RealtimeUsageDocument>(
  "RealtimeUsage",
  realtimeUsageSchema
);

export async function getRealtimeUsageByHour(
  organization: string,
  hour: string
): Promise<RealtimeUsageInterface | null> {
  const realtimeDoc = await RealtimeUsageModel.findOne({ organization, hour });
  return realtimeDoc ? realtimeDoc.toJSON({ flattenMaps: false }) : null;
}
