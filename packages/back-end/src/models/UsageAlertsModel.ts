import mongoose from "mongoose";
interface UsageAlertInterface {
  id: string;
  percentUsed: number;
  orgId: string;
  timeframeEnd: Date;
  meterName: string;
  dateAdded: Date;
}

const usageAlertSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  percentUsed: { type: Number, required: true },
  orgId: { type: String, required: true },
  timeframeEnd: { type: Date, required: true },
  meterName: { type: String, required: true },
  dateAdded: { type: Date, required: true },
});

const usageAlertModel = mongoose.model<UsageAlertInterface>(
  "usageAlert",
  usageAlertSchema
);

export async function addUsageAlert(
  alert: Omit<UsageAlertInterface, "dateAdded">
): Promise<void> {
  await usageAlertModel.create({ ...alert, dateAdded: new Date() });
}
