import { Queries } from "./query";

export interface PastExperiment {
  exposureQueryId: string;
  /** The identifier `users` and `weights` count. Unset on rows found before every identifier was counted. */
  identifierType?: string;
  trackingKey: string;
  experimentName?: string;
  variationNames?: string[];
  numVariations: number;
  variationKeys: string[];
  weights: number[];
  users: number;
  startDate: Date;
  endDate: Date;
  latestData?: Date;
  startOfRange?: boolean;
}

export interface PastExperimentsInterface {
  id: string;
  organization: string;
  datasource: string;
  experiments?: PastExperiment[];
  config?: {
    start: Date;
    end: Date;
  };
  runStarted: Date | null;
  queries: Queries;
  error?: string;
  dateCreated: Date;
  dateUpdated: Date;
  latestData?: Date;
  /** Per assignment query; its watermark is the latest `latestData` of its rows. */
  exposureQueryRuns?: PastExperimentsQueryRun[];
}

export interface PastExperimentsQueryRun {
  exposureQueryId: string;
  /** A change forces a full rerun, so counts on new identifiers aren't partial. */
  identifierTypes: string[];
  /** How far back the query's rows go: the lookback start of its last full run. */
  start: Date;
  lastRunAt: Date;
}
