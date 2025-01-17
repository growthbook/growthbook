import { getCdnUsageByOrg } from "./models/usageModel";

export async function getCdnUsageByOrganization(orgId: string) {
  return await getCdnUsageByOrg(orgId);
}
