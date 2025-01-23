import mongoose from "mongoose";
import { string } from "zod";

interface UsageAlertInterface {
  id: string;
  percentUsed: number;
  orgId: string;
  timeframeEnd: Date;
  meterName: string; // Should we also store the meterId?
  dateAdded: Date;
}

const usageAlertSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  percentUsed: Number,
  orgId: string,
  timeframeEnd: Date,
  meterName: string,
  dateAdded: Date,
});

type UsageAlertDocument = mongoose.Document & UsageAlertInterface;

const usageAlertModel = mongoose.model<UsageAlertInterface>(
  "usageAlert",
  usageAlertSchema
);

export async function addUsageAlert(
  alert: Omit<UsageAlertInterface, "dateAdded">
): Promise<void> {
  await usageAlertModel.create(alert);
}
