import mongoose from "mongoose";
import { ObjectId } from "mongodb";
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

type AuditDocument = mongoose.Document<
  ObjectId | undefined,
  Record<string, never>,
  AuditInterface
> &
  AuditInterface;

export const AuditModel = mongoose.model<AuditDocument>("Audit", auditSchema);
