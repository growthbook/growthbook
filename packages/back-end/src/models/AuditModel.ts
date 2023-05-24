import mongoose from "mongoose";
import { AuditInterface } from "../../types/audit";

const auditSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  organization: {
    type: String,
    index: true,
  },
  user: {
    _id: false,
    id: String,
    email: String,
    name: String,
    apiKey: String,
  },
  reason: String,
  event: String,
  entity: {
    _id: false,
    object: String,
    id: String,
    name: String,
  },
  parent: {
    _id: false,
    object: String,
    id: String,
  },
  details: String,
  dateCreated: Date,
});

// type AuditDocument = mongoose.Document & AuditInterface;

// TODO: don't export and add toInterface() method https://github.com/growthbook/growthbook/issues/1300
export const AuditModel = mongoose.model<AuditInterface>("Audit", auditSchema);
