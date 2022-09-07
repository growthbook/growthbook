import mongoose from "mongoose";
import { ApiKeyInterface } from "../../types/apikey";

const apiKeySchema = new mongoose.Schema({
  key: {
    type: String,
    unique: true,
  },
  environment: String,
  description: String,
  organization: String,
  dateCreated: Date,
});

export type ApiKeyDocument = mongoose.Document & ApiKeyInterface;

export const ApiKeyModel = mongoose.model<ApiKeyDocument>(
  "ApiKey",
  apiKeySchema
);

export async function findOrgIdByAccessToken(accessToken: string) {
  const doc = await ApiKeyModel.findOne({
    key: accessToken,
    environment: "access",
  });
  return doc?.organization;
}
