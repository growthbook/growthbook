import mongoose from "mongoose";
import { SSOConnectionInterface } from "shared/types/sso-connection";

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
});

type SSOConnectionDocument = mongoose.Document & SSOConnectionInterface;

const SSOConnectionModel = mongoose.model<SSOConnectionInterface>(
  "SSOConnection",
  ssoConnectionSchema,
);

function toInterface(doc: SSOConnectionDocument): SSOConnectionInterface {
  return doc.toJSON();
}

export async function getSSOConnectionById(
  id: string,
): Promise<null | SSOConnectionInterface> {
  if (!id) return null;
  const doc = await SSOConnectionModel.findOne({ id });

  return doc ? toInterface(doc) : null;
}

export async function getAllSSOConnections(): Promise<
  SSOConnectionInterface[]
> {
  const connections = await SSOConnectionModel.find();
  return connections.map((c) => toInterface(c));
}

export async function getSSOConnectionByEmailDomain(
  emailDomain: string,
): Promise<null | SSOConnectionInterface> {
  if (!emailDomain) return null;
  const doc = await SSOConnectionModel.findOne({
    emailDomains: emailDomain,
  });

  return doc ? toInterface(doc) : null;
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
