import mongoose from "mongoose";
import {
  SSOConnectionInterface,
  SSOConnectionParams,
} from "../../types/sso-connection";

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
  extraQueryParameters: {},
  metadata: {},
});

type SSOConnectionDocument = mongoose.Document & SSOConnectionInterface;

const SSOConnectionModel = mongoose.model<SSOConnectionDocument>(
  "SSOConnection",
  ssoConnectionSchema
);

export function toSSOConfigParams(
  conn: SSOConnectionInterface
): SSOConnectionParams {
  return {
    id: conn.id || "",
    clientId: conn.clientId,
    clientSecret: conn.clientSecret,
    extraQueryParams: conn.extraQueryParams,
    metadata: conn.metadata,
  };
}

export async function getSSOConnectionById(
  id: string
): Promise<null | SSOConnectionInterface> {
  if (!id) return null;
  const doc = await SSOConnectionModel.findOne({ id });

  return doc ? doc.toJSON() : null;
}

export async function getSSOConnectionByEmailDomain(
  emailDomain: string
): Promise<null | SSOConnectionInterface> {
  if (!emailDomain) return null;
  const doc = await SSOConnectionModel.findOne({ emailDomain });

  return doc ? doc.toJSON() : null;
}
