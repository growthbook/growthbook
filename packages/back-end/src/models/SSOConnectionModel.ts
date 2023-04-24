import mongoose from "mongoose";
import { SSOConnectionInterface } from "../../types/sso-connection";

const ssoConnectionSchema = new mongoose.Schema({
  id: {
    type: String,
    unique: true,
  },
  /* @deprecated */
  emailDomain: {
    type: String,
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

const SSOConnectionModel = mongoose.model<SSOConnectionDocument>(
  "SSOConnection",
  ssoConnectionSchema
);

function toInterface(doc: SSOConnectionDocument): SSOConnectionInterface {
  const conn = doc.toJSON();
  if (conn?.emailDomain) {
    // quick migration for emailDomain -> emailDomains
    conn.emailDomains = [conn.emailDomain];
    delete conn.emailDomain;

    // update the document in the background
    const { id, organization } = conn;
    if (id && organization) {
      SSOConnectionModel.updateOne(
        { id, organization },
        {
          $set: { emailDomains: conn.emailDomains },
          $unset: { emailDomain: 1 },
        }
      );
    }
  }

  return conn;
}

export async function getSSOConnectionById(
  id: string
): Promise<null | SSOConnectionInterface> {
  if (!id) return null;
  const doc = await SSOConnectionModel.findOne({ id });

  return doc ? toInterface(doc) : null;
}

export async function getSSOConnectionByEmailDomain(
  emailDomain: string
): Promise<null | SSOConnectionInterface> {
  if (!emailDomain) return null;
  const doc = await SSOConnectionModel.findOne({
    emailDomains: { $in: [emailDomain] },
  });

  return doc ? toInterface(doc) : null;
}

export function getSSOConnectionSummary(
  conn?: SSOConnectionInterface
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
