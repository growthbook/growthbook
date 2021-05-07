import mongoose from "mongoose";
import { ApiKeyInterface } from "../../types/apikey";

const apiKeySchema = new mongoose.Schema({
  key: String,
  description: String,
  organization: String,
  dateCreated: Date,
});

export type ApiKeyDocument = mongoose.Document & ApiKeyInterface;

export const ApiKeyModel = mongoose.model<ApiKeyDocument>(
  "ApiKey",
  apiKeySchema
);
