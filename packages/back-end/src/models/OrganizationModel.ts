import mongoose, { UpdateQuery } from "mongoose";
import { OrganizationInterface } from "../../types/organization";
import uniqid from "uniqid";

const organizationSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
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
    datasources: [String],
    techsources: [String],
  },
});

organizationSchema.index({ "members.id": 1 });

export type OrganizationDocument = mongoose.Document & OrganizationInterface;

const OrganizationModel = mongoose.model<OrganizationDocument>(
  "Organization",
  organizationSchema
);

export function createOrganization(
  email: string,
  userId: string,
  name: string,
  url: string
) {
  // TODO: sanitize fields
  return OrganizationModel.create({
    ownerEmail: email,
    name,
    url,
    invites: [],
    members: [
      {
        id: userId,
        role: "admin",
      },
    ],
    id: uniqid("org_"),
  });
}
export function findAllOrganizations() {
  return OrganizationModel.find();
}
export function findOrganizationById(id: string) {
  return OrganizationModel.findOne({ id });
}
export function updateOrganization(
  id: string,
  update: UpdateQuery<OrganizationDocument>
) {
  return OrganizationModel.updateOne(
    {
      id,
    },
    update
  );
}

export function updateOrganizationByStripeId(
  stripeCustomerId: string,
  update: UpdateQuery<OrganizationDocument>
) {
  return OrganizationModel.updateOne(
    {
      stripeCustomerId,
    },
    update
  );
}

export async function hasOrganization() {
  const res = await OrganizationModel.findOne();
  return !!res;
}

export function findOrganizationsByMemberId(userId: string) {
  return OrganizationModel.find({
    members: {
      $elemMatch: {
        id: userId,
      },
    },
  });
}

export function findOrganizationByInviteKey(key: string) {
  return OrganizationModel.findOne({
    "invites.key": key,
  });
}

export async function getOrganizationFromSlackTeam(
  teamId: string
): Promise<OrganizationDocument> {
  const organization = await OrganizationModel.findOne({
    "connections.slack.team": teamId,
  });
  if (!organization) {
    throw new Error("Unknown slack team id");
  }

  return organization;
}
