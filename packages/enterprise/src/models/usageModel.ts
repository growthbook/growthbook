import mongoose from "mongoose";

type CdnUsage = {
  hits: number;
  bandwidth: number;
};

type CdnUsages = Record<string, CdnUsage>;

interface OrganizationCdnUsageInterface {
  orgId: string;
  cdnUsages: CdnUsages;
}

type OrganizationCdnUsageDocument = mongoose.Document &
  OrganizationCdnUsageInterface;

const organizationCdnUsageSchema = new mongoose.Schema({
  orgId: {
    type: String,
    unique: true,
  },
  cdnUsages: [Map],
});

const COLLECTION_NAME = "OrganizationCdnUsages";

const licenseDb = mongoose.connection.useDb("licenses");

const usageModel = licenseDb.model(COLLECTION_NAME, organizationCdnUsageSchema);

export async function getCdnUsageByOrg(
  orgId: string
): Promise<OrganizationCdnUsageDocument | null> {
  // Do we want to limit the amount of months we're looking up?
  return usageModel.findOne({ orgId });
}
