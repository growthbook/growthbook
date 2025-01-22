import mongoose from "mongoose";
import omit from "lodash/omit";
import { OrganizationCdnUsageInterface } from "../usage";

type OrganizationCdnUsageDocument = mongoose.Document &
  OrganizationCdnUsageInterface;

const organizationCdnUsageSchema = new mongoose.Schema({
  orgId: {
    type: String,
    unique: true,
  },
});

const COLLECTION_NAME = "newOrganizationCdnUsages";

// MKTODO: should I use the { useCache: true } argument here? Docs - https://mongoosejs.com/docs/api/connection.html#Connection.prototype.useDb()
const licenseDb = mongoose.connection.useDb("licenses");

const UsageModel = licenseDb.model<OrganizationCdnUsageDocument>(
  COLLECTION_NAME,
  organizationCdnUsageSchema
);

export function toInterface(
  doc: OrganizationCdnUsageDocument
): OrganizationCdnUsageInterface {
  const ret = doc.toJSON<OrganizationCdnUsageDocument>();
  return omit(ret, ["__v", "_id"]);
}

export async function getCdnUsageByOrg(
  orgId: string
): Promise<OrganizationCdnUsageInterface | null> {
  const doc = await UsageModel.findOne({ orgId });
  return doc ? toInterface(doc) : null;
}
