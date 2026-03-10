import mongoose from "mongoose";
import { RealtimeUsageInterface } from "shared/types/realtime";

const realtimeUsageSchema = new mongoose.Schema({
  organization: String,
  hour: String,
  features: {},
});
realtimeUsageSchema.index({ organization: 1, hour: 1 }, { unique: true });

export type RealtimeUsageDocument = mongoose.Document & RealtimeUsageInterface;

export const RealtimeUsageModel = mongoose.model<RealtimeUsageInterface>(
  "RealtimeUsage",
  realtimeUsageSchema,
);

export async function getRealtimeUsageByHour(
  organization: string,
  hour: string,
): Promise<RealtimeUsageInterface | null> {
  const realtimeDoc: RealtimeUsageDocument | null =
    await RealtimeUsageModel.findOne({ organization, hour });
  return realtimeDoc ? realtimeDoc.toJSON<RealtimeUsageDocument>() : null;
}
