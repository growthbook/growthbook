import mongoose from "mongoose";
import { SSOConnectionInterface } from "shared/types/sso-connection";
import { IS_CLOUD } from "../util/secrets";

const ssoConnectionSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  emailDomains: {
    type: [String],
    index: true,
  },
  organization: {
    type: String,
    unique: true,
  },
  dateCreated: Date,
  idpType: String,
  clientId: String,
  clientSecret: String,
  extraQueryParameters: {},
  additionalScope: String,
  metadata: {},
  baseURL: String,
  tenantId: String,
  audience: String,
});

type SSOConnectionDocument = mongoose.Document & SSOConnectionInterface;

const SSOConnectionModel = mongoose.model<SSOConnectionInterface>(
  "SSOConnection",
  ssoConnectionSchema,
);

function toInterface(doc: SSOConnectionDocument): SSOConnectionInterface {
  return doc.toJSON();
}

export async function _dangerousGetSSOConnectionById(
  id: string,
): Promise<null | SSOConnectionInterface> {
  if (!id) return null;
  const doc = await SSOConnectionModel.findOne({ id });

  return doc ? toInterface(doc) : null;
}

export async function _dangerousGetAllSSOConnections(): Promise<
  SSOConnectionInterface[]
> {
  const connections = await SSOConnectionModel.find();
  return connections.map((c) => toInterface(c));
}

export async function _dangerousGetSSOConnectionByEmailDomain(
  emailDomain: string,
): Promise<null | SSOConnectionInterface> {
  if (!emailDomain) return null;
  const doc = await SSOConnectionModel.findOne({
    emailDomains: emailDomain,
  });

  return doc ? toInterface(doc) : null;
}

export async function _dangerousCreateSSOConnection(
  data: SSOConnectionInterface,
) {
  if (!data.id) {
    throw new Error("SSO Connection must have an id");
  }
  if (!data.organization) {
    throw new Error("SSO Connection must have an organization");
  }
  if (!IS_CLOUD) {
    throw new Error(
      "SSO Connections can only be created via UI in GrowthBook Cloud",
    );
  }

  const doc = await SSOConnectionModel.create({
    ...data,
    dateCreated: new Date(),
  });
  return toInterface(doc);
}

export async function _dangerouseUpdateSSOConnection(
  existing: SSOConnectionInterface,
  data: Partial<SSOConnectionInterface>,
) {
  if ("id" in data) {
    throw new Error("SSO Connection ID cannot be changed");
  }
  if ("organization" in data) {
    throw new Error("SSO Connection organization cannot be changed");
  }
  if (!IS_CLOUD) {
    throw new Error(
      "SSO Connections can only be updated via UI in GrowthBook Cloud",
    );
  }

  const updates = { ...data };
  // Leave the client secret unchanged if an empty string is passed
  // We don't pass clientSecret to the front-end, so this is how we indicate no change
  if (data.clientSecret === "") {
    delete updates.clientSecret;
  }

  await SSOConnectionModel.updateOne({ id: existing.id }, { $set: updates });
}

export function getSSOConnectionSummary(
  conn?: SSOConnectionInterface,
): Partial<SSOConnectionInterface> | null {
  if (!conn) {
    return null;
  }
  return {
    emailDomains: conn.emailDomains,
    idpType: conn.idpType,
    clientId: conn.clientId,
    clientSecret: conn.clientSecret ? "********" : undefined,
    extraQueryParams: conn.extraQueryParams,
    additionalScope: conn.additionalScope,
    metadata: conn.metadata,
  };
}
