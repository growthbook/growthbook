export type RealtimeUsageKeys =
  | "_overall"
  | "featureKey"
  | "featureKey_ruleId"
  | "featureKey_ruleId_variationId";

export interface RealtimeUsageInterface {
  organization: string;
  hour: string;
  features: Record<
    string,
    {
      used: number[];
      skipped: number[];
    }
  >;
}
