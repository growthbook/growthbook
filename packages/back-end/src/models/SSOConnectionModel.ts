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
});

type SSOConnectionDocument = mongoose.Document & SSOConnectionInterface;

const SSOConnectionModel = mongoose.model<SSOConnectionDocument>(
  "SSOConnection",
  ssoConnectionSchema
);

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

export function getSSOConnectionParams(
  connection: SSOConnectionInterface
): SSOConnectionParams {
  return {
    id: connection.id || "",
    authority: connection.authority,
    clientId: connection.clientId,
  };
}
