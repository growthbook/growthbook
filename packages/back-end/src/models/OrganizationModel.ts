import mongoose from "mongoose";
import { OrganizationInterface } from "../../types/organization";
import uniqid from "uniqid";
import { upgradeOrganizationDoc } from "../util/migrations";

const organizationSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  dateCreated: Date,
  url: String,
  name: String,
  ownerEmail: String,
  restrictLoginMethod: String,
  restrictAuthSubPrefix: String,
  members: [
    {
      _id: false,
      id: String,
      role: String,
      limitAccessByEnvironment: Boolean,
      environments: [String],
    },
  ],
  invites: [
    {
      _id: false,
      email: String,
      key: String,
      dateCreated: Date,
      role: String,
      limitAccessByEnvironment: Boolean,
      environments: [String],
    },
  ],
  stripeCustomerId: String,
  discountCode: String,
  priceId: String,
  freeSeats: Number,
  disableSelfServeBilling: Boolean,
  enterprise: Boolean,
  subscription: {
    id: String,
    qty: Number,
    trialEnd: Date,
    status: String,
    current_period_end: Number,
    cancel_at: Number,
    canceled_at: Number,
    cancel_at_period_end: Boolean,
    planNickname: String,
    priceId: String,
  },
  connections: {
    slack: {
      team: String,
      token: String,
    },
    vercel: {
      token: String,
      configurationId: String,
      teamId: String,
    },
  },
  settings: {},
});

organizationSchema.index({ "members.id": 1 });

type OrganizationDocument = mongoose.Document & OrganizationInterface;

const OrganizationModel = mongoose.model<OrganizationDocument>(
  "Organization",
  organizationSchema
);

function toInterface(doc: OrganizationDocument): OrganizationInterface {
  return upgradeOrganizationDoc(doc.toJSON());
}

export async function createOrganization(
  email: string,
  userId: string,
  name: string,
  url: string
) {
  // TODO: sanitize fields
  const doc = await OrganizationModel.create({
    ownerEmail: email,
    name,
    url,
    invites: [],
    members: [
      {
        id: userId,
        role: "admin",
        limitAccessByEnvironment: false,
        environments: [],
      },
    ],
    id: uniqid("org_"),
    dateCreated: new Date(),
    settings: {
      environments: [
        {
          id: "production",
          description: "",
          toggleOnList: true,
          defaultState: true,
        },
      ],
    },
  });
  return toInterface(doc);
}
export async function findAllOrganizations() {
  const docs = await OrganizationModel.find();
  return docs.map(toInterface);
}
export async function findOrganizationById(id: string) {
  const doc = await OrganizationModel.findOne({ id });
  return doc ? toInterface(doc) : null;
}
export async function updateOrganization(
  id: string,
  update: Partial<OrganizationInterface>
) {
  await OrganizationModel.updateOne(
    {
      id,
    },
    {
      $set: update,
    }
  );
}

export async function updateOrganizationByStripeId(
  stripeCustomerId: string,
  update: Partial<OrganizationInterface>
) {
  await OrganizationModel.updateOne(
    {
      stripeCustomerId,
    },
    {
      $set: update,
    }
  );
}

export async function findOrganizationByStripeCustomerId(id: string) {
  const doc = await OrganizationModel.findOne({
    stripeCustomerId: id,
  });

  return doc ? toInterface(doc) : null;
}

export async function hasOrganization() {
  const res = await OrganizationModel.findOne();
  return !!res;
}

export async function findOrganizationsByMemberId(userId: string) {
  const docs = await OrganizationModel.find({
    members: {
      $elemMatch: {
        id: userId,
      },
    },
  });
  return docs.map(toInterface);
}

export async function findOrganizationByInviteKey(key: string) {
  const doc = await OrganizationModel.findOne({
    "invites.key": key,
  });
  return doc ? toInterface(doc) : null;
}

export async function getOrganizationFromSlackTeam(teamId: string) {
  const organization = await OrganizationModel.findOne({
    "connections.slack.team": teamId,
  });
  if (!organization) {
    throw new Error("Unknown slack team id");
  }

  return toInterface(organization);
}

export async function getOrganizationsWithNorthStars() {
  const withNorthStars = await OrganizationModel.find({
    "settings.northStar.metricIds": {
      $exists: true,
      $ne: [],
    },
  });
  return withNorthStars.map(toInterface);
}
