import mongoose from "mongoose";
import { AuditInterface } from "../../types/audit";

const auditSchema = new mongoose.Schema({
  id: String,
  organization: String,
  user: {
    _id: false,
    id: String,
    email: String,
    name: String,
  },
  event: String,
  entity: {
    _id: false,
    object: String,
    id: String,
  },
  parent: {
    _id: false,
    object: String,
    id: String,
  },
  details: String,
  dateCreated: Date,
});

export type AuditDocument = mongoose.Document & AuditInterface;

export const AuditModel = mongoose.model<AuditDocument>("Audit", auditSchema);
