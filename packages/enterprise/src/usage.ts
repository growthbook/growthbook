import { getCdnUsageByOrg } from "./models/usageModel";
// import { AccountPlan } from "./license";
export type CdnUsage = {
  hits: number;
  bandwidth: number;
};

export type CdnUsagePercent = {
  hitsPercent: number;
  bandwidthPercent: number;
};

export type meterUsage = {
  meter: "hits" | "bandwidth";
  usage: number;
  limit: number;
  percentUsed: number;
};

type CdnUsages = Record<string, CdnUsage>;
//MKTODO: Not sure about the `number` type for bandwidth.
// type PlanUsageLimits = Record<AccountPlan, { hits: number; bandwidth: number }>;

// const planUsageLimits: PlanUsageLimits = {
//   oss: { hits: 1000000, bandwidth: 5 },
//   starter: { hits: 1000000, bandwidth: 5 },
//   pro: { hits: 2000000, bandwidth: 10 },
//   pro_sso: { hits: 2000000, bandwidth: 10 },
//   enterprise: { hits: 0, bandwidth: 0 }, // Placeholder for customizable limits - Update with plan meter data
// };

export interface OrganizationCdnUsageInterface {
  orgId: string;
  cdnUsages: CdnUsages;
}

export async function getCdnUsageByOrganization(orgId: string) {
  return await getCdnUsageByOrg(orgId);
}

export function calculateCurrentCdnUsage(): CdnUsagePercent {
  // org: OrganizationInterface,
  // usage: CdnUsages
  // const limits = planUsageLimits[getAccountPlan(org)];

  // console.log("usage", usage);
  //
  // get usage for current month and year

  //MKTODO: This is just mocked data. Need to update logic when the shape is finalized

  return {
    hitsPercent: 85,
    bandwidthPercent: 70,
  };
}
