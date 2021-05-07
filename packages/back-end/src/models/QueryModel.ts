import mongoose from "mongoose";
import { QueryInterface } from "../../types/query";

export const queriesSchema = [
  {
    _id: false,
    query: String,
    status: String,
    name: String,
  },
];

const querySchema = new mongoose.Schema({
  id: String,
  organization: String,
  datasource: String,
  language: String,
  query: String,
  status: String,
  createdAt: Date,
  startedAt: Date,
  finishedAt: Date,
  heartbeat: Date,
  result: {},
  error: String,
});

export type QueryDocument = mongoose.Document & QueryInterface;

export const QueryModel = mongoose.model<QueryDocument>("Query", querySchema);
