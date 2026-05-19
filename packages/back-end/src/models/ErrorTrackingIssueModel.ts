import mongoose from "mongoose";

const errorTrackingIssueSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  organization: { type: String, index: true },
  clientKey: { type: String, index: true },
  fingerprint: { type: String, index: true },
  assigneeUserId: String,
  priority: {
    type: String,
    enum: ["low", "medium", "high", "critical"],
    default: "medium",
  },
  status: {
    type: String,
    enum: ["open", "resolved", "muted"],
    default: "open",
  },
  resolvedAt: Date,
  resolvedInRelease: String,
  comments: [
    {
      _id: false,
      userId: String,
      userName: String,
      body: String,
      date: Date,
    },
  ],
  dateCreated: Date,
  dateUpdated: Date,
});

errorTrackingIssueSchema.index(
  { organization: 1, clientKey: 1, fingerprint: 1 },
  { unique: true },
);

export type ErrorTrackingIssueDocument = mongoose.Document & {
  id: string;
  organization: string;
  clientKey: string;
  fingerprint: string;
  assigneeUserId?: string;
  priority: string;
  status: string;
  resolvedAt?: Date;
  resolvedInRelease?: string;
  comments: { userId: string; userName: string; body: string; date: Date }[];
  dateCreated: Date;
  dateUpdated: Date;
};

export const ErrorTrackingIssueModel = mongoose.model(
  "ErrorTrackingIssue",
  errorTrackingIssueSchema,
) as mongoose.Model<ErrorTrackingIssueDocument>;
