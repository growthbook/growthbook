export type RealtimeUsageKeys =
  | "_overall"
  | "featureKey"
  | "featureKey_ruleId"
  | "featureKey_ruleId_variationId";

export interface RealtimeUsageInterface {
  organization: string;
  hour: number;
  counts: {
    [key: string]: {
      total: number;
      minutes: { [key: number]: number };
    };
  };
}

export interface SummaryUsageInterface {
  organization: string;
  lastUsed: Date;
  counts: {
    [key: string]: {
      lastUsed: Date;
      allTime: number;
      yesterday: number;
      last7days: number;
      last30days: number;
    };
  };
}
