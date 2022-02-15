import mongoose from "mongoose";
import {
  RealtimeUsageInterface,
  SummaryUsageInterface,
} from "../../types/realtime";

const realtimeUsageSchema = new mongoose.Schema({
  _id: false,
  organization: String,
  hour: Number,
  counts: [
    {
      _id: false,
      key: String,
      total: Number,
      minutes: [Number],
    },
  ],
});

export type RealtimeUsageDocument = mongoose.Document & RealtimeUsageInterface;

export const RealtimeUsageModel = mongoose.model<RealtimeUsageDocument>(
  "RealtimeUsage",
  realtimeUsageSchema
);

const summaryUsageSchema = new mongoose.Schema({
  _id: false,
  organization: String,
  lastUsed: Date,
  counts: [
    {
      _id: false,
      key: String,
      lastUsed: Date,
      allTime: Number,
      yesterday: Number,
      last7days: Number,
      last30days: Number,
    },
  ],
});

export type SummaryUsageDocument = mongoose.Document & SummaryUsageInterface;

export const SummaryUsageModel = mongoose.model<SummaryUsageDocument>(
  "SummaryUsage",
  summaryUsageSchema
);

export async function getRealtimeFeatureByHour(
  organization: string,
  hour: number
): Promise<RealtimeUsageInterface | null> {
  const realtimeDoc = await RealtimeUsageModel.findOne({ organization, hour });
  return realtimeDoc ? realtimeDoc.toJSON() : null;
}

export async function updateRealtimeUsage(
  organization: string,
  hour: number,
  updates: Partial<RealtimeUsageInterface>
) {
  await RealtimeUsageModel.updateOne(
    { organization, hour },
    {
      $set: updates,
    }
  );
}

export async function getRealtimeSummaryForOrg(
  organization: string
): Promise<SummaryUsageInterface | null> {
  const summary = await SummaryUsageModel.findOne({ organization });
  return summary ? summary.toJSON() : null;
}
