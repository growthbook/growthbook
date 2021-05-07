import { QueryLanguage } from "./datasource";

export interface SnapshotMetric {
  value: number;
  cr: number;
  users: number;
  ci?: [number, number];
  expected?: number;
  buckets?: {
    x: number;
    y: number;
  }[];
  chanceToWin?: number;
}

export interface SnapshotVariation {
  users: number;
  metrics: {
    [key: string]: SnapshotMetric;
  };
}

export interface ExperimentSnapshotInterface {
  id: string;
  experiment: string;
  phase: number;
  dateCreated: Date;
  manual: boolean;
  query?: string;
  queryLanguage?: QueryLanguage;
  dimension?: string;
  results: {
    name: string;
    srm: number;
    variations: SnapshotVariation[];
  }[];
}
