import { SnapshotMetric } from "./experiment-snapshot";
import { Queries } from "./query";

export type SegmentComparisonResults = {
  users: {
    segment1: number;
    segment2: number;
  };
  metrics: {
    [key: string]: {
      segment1: {
        value: number;
        cr: number;
        users: number;
      };
      segment2: SnapshotMetric;
    };
  };
};

export interface SegmentComparisonInterface {
  id: string;
  organization: string;
  title: string;
  datasource: string;
  metrics: string[];
  segment1: {
    segment: string;
    from: Date;
    to: Date;
  };
  segment2: {
    segment: string;
    sameDateRange: boolean;
    from?: Date;
    to?: Date;
  };
  runStarted: Date;
  queries: Queries;
  results?: SegmentComparisonResults;
  dateCreated: Date;
  dateUpdated: Date;
}
