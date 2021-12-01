import mongoose from "mongoose";
import { OrganizationInterface } from "../../types/organization";
import uniqid from "uniqid";
import { getConfigOrganizationSettings } from "../init/config";

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
  settings: {},
});

organizationSchema.index({ "members.id": 1 });

type OrganizationDocument = mongoose.Document & OrganizationInterface;

const OrganizationModel = mongoose.model<OrganizationDocument>(
  "Organization",
  organizationSchema
);

function toInterface(doc: OrganizationDocument): OrganizationInterface {
  const json = doc.toJSON();

  // Change old `implementationTypes` field to new `visualEditorEnabled` field
  if (json.settings?.implementationTypes) {
    if (!("visualEditorEnabled" in json.settings)) {
      json.settings.visualEditorEnabled = json.settings.implementationTypes.includes(
        "visual"
      );
    }
    delete json.settings.implementationTypes;
  }

  // Add settings from config.json
  const configSettings = getConfigOrganizationSettings();
  json.settings = Object.assign({}, json.settings || {}, configSettings);

  return json;
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
      },
    ],
    id: uniqid("org_"),
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
