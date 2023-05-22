import mongoose from "mongoose";
import { ObjectId } from "mongodb";
import { SSOConnectionInterface } from "../../types/sso-connection";

const ssoConnectionSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  emailDomain: {
    type: String,
    unique: true,
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

type SSOConnectionDocument = mongoose.Document<
  ObjectId | undefined,
  Record<string, never>,
  SSOConnectionInterface
> &
  SSOConnectionInterface;

const SSOConnectionModel = mongoose.model<SSOConnectionDocument>(
  "SSOConnection",
  ssoConnectionSchema
);

export async function getSSOConnectionById(
  id: string
): Promise<null | SSOConnectionInterface> {
  if (!id) return null;
  const doc = await SSOConnectionModel.findOne({ id });

  return doc ? doc.toJSON({ flattenMaps: false }) : null;
}

export async function getSSOConnectionByEmailDomain(
  emailDomain: string
): Promise<null | SSOConnectionInterface> {
  if (!emailDomain) return null;
  const doc = await SSOConnectionModel.findOne({ emailDomain });

  return doc ? doc.toJSON({ flattenMaps: false }) : null;
}

export function getSSOConnectionSummary(
  conn?: SSOConnectionInterface
): Partial<SSOConnectionInterface> | null {
  if (!conn) {
    return null;
  }
  return {
    emailDomain: conn.emailDomain,
    idpType: conn.idpType,
    clientId: conn.clientId,
    clientSecret: conn.clientSecret ? "********" : undefined,
    extraQueryParams: conn.extraQueryParams,
    additionalScope: conn.additionalScope,
    metadata: conn.metadata,
  };
}
