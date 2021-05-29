import mongoose from "mongoose";
import { OrganizationInterface } from "../../types/organization";

const organizationSchema = new mongoose.Schema({
  id: String,
  url: String,
  name: String,
  ownerEmail: String,
  members: [
    {
      _id: false,
      id: String,
      role: String,
    },
  ],
  invites: [
    {
      _id: false,
      email: String,
      key: String,
      dateCreated: Date,
      role: String,
    },
  ],
  stripeCustomerId: String,
  subscription: {
    id: String,
    qty: Number,
    trialEnd: Date,
    status: String,
  },
  connections: {
    slack: {
      team: String,
      token: String,
    },
  },
  settings: {
    implementationTypes: [String],
    confidenceLevel: Number,
    customized: Boolean,
    logoPath: String,
    primaryColor: String,
    secondaryColor: String,
  },
});

export type OrganizationDocument = mongoose.Document & OrganizationInterface;

export const OrganizationModel = mongoose.model<OrganizationDocument>(
  "Organization",
  organizationSchema
);
