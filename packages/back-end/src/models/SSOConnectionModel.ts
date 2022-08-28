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
  authority: String,
  clientId: String,
  extraQueryParameters: {},
  metadata: {},
});

type SSOConnectionDocument = mongoose.Document & SSOConnectionInterface;

const SSOConnectionModel = mongoose.model<SSOConnectionDocument>(
  "SSOConnection",
  ssoConnectionSchema
);

function toParams(doc: SSOConnectionDocument): SSOConnectionParams {
  return {
    id: doc.id || "",
    authority: doc.authority,
    clientId: doc.clientId,
    extraQueryParams: doc.extraQueryParams,
    metadata: doc.metadata,
  };
}

export async function getSSOConnectionById(
  id: string
): Promise<null | SSOConnectionParams> {
  if (!id) return null;
  const doc = await SSOConnectionModel.findOne({ id });

  return doc ? toParams(doc) : null;
}

export async function getSSOConnectionByEmailDomain(
  emailDomain: string
): Promise<null | SSOConnectionParams> {
  if (!emailDomain) return null;
  const doc = await SSOConnectionModel.findOne({ emailDomain });

  return doc ? toParams(doc) : null;
}
