export interface RealtimeUsageInterface {
  organization: string;
  hour: string;
  features: Record<string, RealtimeFeatureUsage>;
}

export interface RealtimeFeatureUsage {
  used: Record<number, number>;
  skipped: Record<number, number>;
}

export interface FeatureRealtimeUsageRecord {
  used: number;
  skipped: number;
}

export type FeatureUsageRecords = Record<
  string,
  {
    realtime: FeatureRealtimeUsageRecord[];
  }
>;
