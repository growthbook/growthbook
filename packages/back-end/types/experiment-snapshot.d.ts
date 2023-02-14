import { QueryLanguage } from "./datasource";
import { StatsEngine, VariationResponse } from "./stats";
import { Queries } from "./query";

export interface SnapshotMetric extends VariationResponse {
  buckets?: {
    x: number;
    y: number;
  }[];
}

export interface SnapshotVariation {
  users: number;
  metrics: {
    [key: string]: SnapshotMetric;
  };
}

export interface ExperimentSnapshotInterface {
  id: string;
  organization: string;
  experiment: string;
  error?: string;
  phase: number;
  dateCreated: Date;
  runStarted: Date | null;
  manual: boolean;
  query?: string;
  queryLanguage?: QueryLanguage;
  queries: Queries;
  dimension: string | null;
  unknownVariations?: string[];
  multipleExposures?: number;
  hasCorrectedStats?: boolean;
  results?: {
    name: string;
    srm: number;
    variations: SnapshotVariation[];
  }[];
  hasRawQueries?: boolean;
  queryFilter?: string;
  segment?: string;
  activationMetric?: string;
  skipPartialData?: boolean;
  statsEngine?: StatsEngine;
}
